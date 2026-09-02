import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pins the four ways `allocateReceipt` is allowed to decline.
 *
 * Its sibling `service.transaction.test.ts` covers the REVERSAL path's transaction boundary.
 * This file covers the entry conditions on the forward path — every one of which is a guard
 * against putting money in the ledger that does not belong there:
 *
 *   - a receipt already allocated must not be allocated a second time (double credit)
 *   - a receipt whose allocations were REVERSED must be allocatable again (stranded credit —
 *     the opposite failure, and the reason the guard filters on reversedAt rather than counting
 *     every row)
 *   - a non-rent receipt must never reach the rent ledger
 *   - a tenant with two active leases must not be guessed at
 *
 * All four are silent when they break. Nothing throws, nothing logs; a tenant is simply credited
 * twice, or not at all, and the derived paymentStatus follows the wrong ledger.
 *
 * WHAT THIS DOES NOT DO. Same limit as its sibling: the Prisma client is mocked, so no SQL runs
 * and no unique constraint is exercised. The DB-backed test is still open (P1 #4b) and still
 * blocked by Prisma's AI-agent guard on `db push`.
 */

const { prismaMock, transactionSpy, txClient } = vi.hoisted(() => {
  const txClient = {
    rentPeriod: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    paymentAllocation: { create: vi.fn() },
    receipt: { update: vi.fn() },
    tenant: { update: vi.fn() },
  };
  const transactionSpy = vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) =>
    fn(txClient),
  );
  const prismaMock = {
    receipt: { findUnique: vi.fn() },
    paymentAllocation: { count: vi.fn() },
    lease: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    rentPeriod: { findMany: vi.fn(), createMany: vi.fn() },
    $transaction: transactionSpy,
  };
  return { prismaMock, transactionSpy, txClient };
});

const { logAuditMock } = vi.hoisted(() => ({ logAuditMock: vi.fn() }));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));

import { allocateReceipt } from "./service";

const RECEIPT_ID = "receipt-1";
const TENANT_ID = "tenant-1";
const LEASE_ID = "lease-1";

const rentReceipt = (overrides: Record<string, unknown> = {}) => ({
  id: RECEIPT_ID,
  userId: "user-1",
  tenantId: TENANT_ID,
  propertyId: "property-1",
  leaseId: LEASE_ID,
  amount: 1250,
  date: new Date("2026-06-01T00:00:00.000Z"),
  type: "rent",
  ...overrides,
});

/** A lease with one open June period — enough for a plan with exactly one entry. */
function givenAnAllocatableLease() {
  prismaMock.lease.findUnique.mockResolvedValue({
    id: LEASE_ID,
    userId: "user-1",
    tenantId: TENANT_ID,
    propertyId: "property-1",
    monthlyRent: 1250,
    startDate: new Date("2026-06-01T00:00:00.000Z"),
    endDate: new Date("2026-06-30T00:00:00.000Z"),
  });
  prismaMock.lease.findUniqueOrThrow.mockResolvedValue({
    id: LEASE_ID,
    userId: "user-1",
    tenantId: TENANT_ID,
    propertyId: "property-1",
    monthlyRent: 1250,
  });
  prismaMock.rentPeriod.findMany.mockResolvedValue([
    { id: "period-6", year: 2026, month: 6, dueAmount: 1250, allocatedAmount: 0 },
  ]);
  txClient.rentPeriod.findUniqueOrThrow.mockResolvedValue({
    id: "period-6",
    dueDate: new Date("2026-06-01T00:00:00.000Z"),
    dueAmount: 1250,
    allocatedAmount: 0,
  });
  txClient.rentPeriod.findMany.mockResolvedValue([{ status: "paid" }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  logAuditMock.mockResolvedValue(undefined);
  prismaMock.receipt.findUnique.mockResolvedValue(rentReceipt());
  prismaMock.paymentAllocation.count.mockResolvedValue(0);
  prismaMock.rentPeriod.createMany.mockResolvedValue({ count: 0 });
  givenAnAllocatableLease();
});

describe("allocateReceipt — the same payment is never credited twice", () => {
  it("declines a receipt that already has live allocations", async () => {
    prismaMock.paymentAllocation.count.mockResolvedValue(1);

    const plan = await allocateReceipt(RECEIPT_ID);

    // Declining means returning null BEFORE any write — not writing and then compensating.
    expect(plan).toBeNull();
    expect(transactionSpy).not.toHaveBeenCalled();
    expect(txClient.paymentAllocation.create).not.toHaveBeenCalled();
    expect(txClient.tenant.update).not.toHaveBeenCalled();
  });

  it("counts only live allocations, ignoring reversed ones", async () => {
    await allocateReceipt(RECEIPT_ID);

    // The `reversedAt: null` filter is the whole guard. Counting every allocation row would
    // permanently strand a voided-and-reissued receipt: its reversed rows would look like
    // proof it had already been credited, and it would never allocate again.
    expect(prismaMock.paymentAllocation.count).toHaveBeenCalledWith({
      where: { receiptId: RECEIPT_ID, reversedAt: null },
    });
  });

  it("allocates normally when no live allocations exist", async () => {
    const plan = await allocateReceipt(RECEIPT_ID);

    // The positive control. Without it the two cases above would also pass against a function
    // that declined everything unconditionally.
    expect(plan?.entries).toHaveLength(1);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(txClient.paymentAllocation.create).toHaveBeenCalledTimes(1);
  });
});

describe("allocateReceipt — receipts that do not belong in the rent ledger", () => {
  it.each(["expense", "deposit", "fee"])("declines a %s receipt", async (type) => {
    prismaMock.receipt.findUnique.mockResolvedValue(rentReceipt({ type }));

    expect(await allocateReceipt(RECEIPT_ID)).toBeNull();
    expect(transactionSpy).not.toHaveBeenCalled();
    // A deposit allocated as rent would mark a month paid that nobody paid rent for, and the
    // tenant's derived status would follow it.
    expect(prismaMock.paymentAllocation.count).not.toHaveBeenCalled();
  });

  it("declines a receipt that does not exist", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(null);

    expect(await allocateReceipt(RECEIPT_ID)).toBeNull();
    expect(transactionSpy).not.toHaveBeenCalled();
  });
});

describe("allocateReceipt — an unlinked receipt is resolved, never guessed", () => {
  it("uses the tenant's single active lease when the receipt has no leaseId", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(rentReceipt({ leaseId: null }));
    prismaMock.lease.findMany.mockResolvedValue([{ id: LEASE_ID }]);

    const plan = await allocateReceipt(RECEIPT_ID);

    expect(plan?.entries).toHaveLength(1);
    expect(prismaMock.lease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID, status: "active" } }),
    );
  });

  it("declines when the tenant has two active leases rather than picking one", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(rentReceipt({ leaseId: null }));
    prismaMock.lease.findMany.mockResolvedValue([{ id: LEASE_ID }, { id: "lease-2" }]);

    // Guessing here would credit rent against the wrong property — recoverable only by someone
    // noticing. Declining leaves the receipt visibly unallocated, which is the reviewable state.
    expect(await allocateReceipt(RECEIPT_ID)).toBeNull();
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("declines when the tenant has no active lease at all", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(rentReceipt({ leaseId: null }));
    prismaMock.lease.findMany.mockResolvedValue([]);

    expect(await allocateReceipt(RECEIPT_ID)).toBeNull();
    expect(transactionSpy).not.toHaveBeenCalled();
  });
});

describe("allocateReceipt — the receipt points at the period it was actually allocated to", () => {
  it("back-links to the row it created when the first entry is a future period", async () => {
    // Every existing period is settled, so the waterfall has nothing to fill and pass 2 of the
    // engine invents a future one: the tenant is paying a month ahead. That entry carries no
    // `id` — the row does not exist until the loop inserts it — so reading the id back off the
    // PLAN yields undefined, and the receipt keeps a referenceMonth with a null rentPeriodId.
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      { id: "period-6", year: 2026, month: 6, dueAmount: 1250, allocatedAmount: 1250 },
    ]);
    txClient.rentPeriod.create.mockResolvedValue({
      id: "period-7",
      dueDate: new Date("2026-07-01T00:00:00.000Z"),
      dueAmount: 1250,
      allocatedAmount: 0,
    });

    await allocateReceipt(RECEIPT_ID);

    // The row was materialized...
    expect(txClient.rentPeriod.create).toHaveBeenCalled();
    // ...and the receipt points at THAT row, not at undefined.
    expect(txClient.receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rentPeriodId: "period-7", referenceMonth: "2026-07" }),
      }),
    );
  });

  it("back-links to the existing row when the first entry is an open period", async () => {
    // The unchanged case, pinned so the fix cannot regress it in the other direction.
    await allocateReceipt(RECEIPT_ID);

    expect(txClient.rentPeriod.create).not.toHaveBeenCalled();
    expect(txClient.receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rentPeriodId: "period-6", referenceMonth: "2026-06" }),
      }),
    );
  });
});
