import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the transaction boundary of the allocation write path.
 *
 * `engine.test.ts` covers the waterfall thoroughly — but it tests a PURE function.
 * `service.ts`, which applies a plan to the database, had no test at all, so the single most
 * important invariant in the product was asserted nowhere:
 *
 *   the allocation row, the rent-period totals and status, and the derived
 *   `tenant.paymentStatus` are all written inside ONE transaction
 *
 * If the period update or the tenant recompute could land outside it, a partial failure would
 * leave the ledger disagreeing with itself — allocations recorded against a period whose
 * status never moved, or a tenant marked paid on the strength of a write that rolled back.
 *
 * WHAT THIS DOES NOT DO. It does not exercise SQL. A real integration test needs a database,
 * and `npx prisma db push` is blocked by Prisma's AI-agent guard — which is exactly why every
 * `*.integration.test.ts` suite fails locally. Rather than write a test that cannot be run here,
 * this asserts the boundary structurally: every write lands on the `tx` handle, never the base
 * client. A DB-level integration test of this boundary does not exist yet.
 */

type Spy = ReturnType<typeof vi.fn>;

const { txClient, prismaMock, transactionSpy } = vi.hoisted(() => {
  const txClient = {
    rentPeriod: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    paymentAllocation: { create: vi.fn(), update: vi.fn() },
    receipt: { update: vi.fn() },
    tenant: { update: vi.fn() },
  };
  const transactionSpy = vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) =>
    fn(txClient),
  );
  const prismaMock = {
    // Base-client handles. If a write lands here instead of on txClient, it escaped the
    // transaction — which is the bug these tests exist to catch.
    rentPeriod: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    paymentAllocation: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    receipt: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    tenant: { update: vi.fn() },
    lease: { findUniqueOrThrow: vi.fn() },
    $transaction: transactionSpy,
  };
  return { txClient, prismaMock, transactionSpy };
});

const { logAuditMock } = vi.hoisted(() => ({ logAuditMock: vi.fn() }));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));

import { reverseAllocationsForReceipt } from "./service";

const RECEIPT_ID = "receipt-1";
const TENANT_ID = "tenant-1";

beforeEach(() => {
  vi.clearAllMocks();
  logAuditMock.mockResolvedValue(undefined);
  prismaMock.receipt.findUniqueOrThrow.mockResolvedValue({
    id: RECEIPT_ID,
    userId: "user-1",
    tenantId: TENANT_ID,
  });
  txClient.rentPeriod.findUniqueOrThrow.mockResolvedValue({
    id: "period-1",
    dueDate: new Date("2026-06-01"),
    dueAmount: 1250,
    allocatedAmount: 1250,
    paidAt: new Date("2026-06-01"),
  });
  txClient.rentPeriod.findMany.mockResolvedValue([{ status: "paid" }]);
});

const oneLiveAllocation = () =>
  prismaMock.paymentAllocation.findMany.mockResolvedValue([
    { id: "alloc-1", rentPeriodId: "period-1", amount: 1250 },
  ]);

describe("reverseAllocationsForReceipt — transaction boundary", () => {
  it("performs every write on the tx handle, never the base client", async () => {
    oneLiveAllocation();

    await reverseAllocationsForReceipt(RECEIPT_ID, "voided");

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(txClient.paymentAllocation.update).toHaveBeenCalled();
    expect(txClient.rentPeriod.update).toHaveBeenCalled();
    expect(txClient.tenant.update).toHaveBeenCalled();

    // The load-bearing half of the assertion.
    expect(prismaMock.paymentAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.rentPeriod.update).not.toHaveBeenCalled();
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  it("recomputes the derived tenant status inside the same transaction", async () => {
    oneLiveAllocation();

    await reverseAllocationsForReceipt(RECEIPT_ID, "voided");

    // Reading the periods and writing the tenant must both be on tx — a recompute that read
    // committed state from outside would derive the status from pre-reversal rows.
    expect(txClient.rentPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID } }),
    );
    expect(prismaMock.rentPeriod.findMany).not.toHaveBeenCalled();
  });

  it("soft-reverses: marks reversedAt with a reason, never deletes", async () => {
    oneLiveAllocation();

    await reverseAllocationsForReceipt(RECEIPT_ID, "duplicate payment");

    const [[call]] = (txClient.paymentAllocation.update as Spy).mock.calls;
    expect(call.data.reversedAt).toBeInstanceOf(Date);
    expect(call.data.reversalReason).toBe("duplicate payment");
    // Financial history survives — there is no delete on the tx client at all.
    expect(txClient.paymentAllocation).not.toHaveProperty("delete");
  });

  it("joins a caller's transaction instead of opening its own when given one", async () => {
    oneLiveAllocation();

    // The receipt lifecycle passes its tx down so the reversal and the lifecycle write commit
    // together. Prisma cannot nest transactions, so opening a second one here would throw at
    // runtime against a real client.
    await reverseAllocationsForReceipt(RECEIPT_ID, "voided", txClient as never);

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(txClient.paymentAllocation.update).toHaveBeenCalled();
  });

  it("writes the audit entry only after the transaction resolves", async () => {
    oneLiveAllocation();
    const order: string[] = [];
    transactionSpy.mockImplementationOnce(async (fn) => {
      order.push("transaction");
      return fn(txClient);
    });
    logAuditMock.mockImplementationOnce(async () => {
      order.push("audit");
    });

    await reverseAllocationsForReceipt(RECEIPT_ID, "voided");

    // Audit is deliberately outside the transaction — an audit failure must not roll back a
    // correct financial reversal — but it must not run before the money is committed either.
    expect(order).toEqual(["transaction", "audit"]);
  });

  it("does nothing at all when there are no live allocations", async () => {
    prismaMock.paymentAllocation.findMany.mockResolvedValue([]);

    const count = await reverseAllocationsForReceipt(RECEIPT_ID, "voided");

    expect(count).toBe(0);
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
