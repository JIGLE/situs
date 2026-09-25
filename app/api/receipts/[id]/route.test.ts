import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `PUT /api/receipts/[id]` rewrites a receipt the caller owns — but the ids it writes INTO it came
 * from the request and were never checked. The update `include`s the full tenant and property, so
 * pointing a receipt at someone else's tenant echoed that tenant's email, phone and rent back.
 * `receiptService.create` has checked these since the ownership sweep; `update` never did.
 */

const { prismaMock, allocation } = vi.hoisted(() => ({
  prismaMock: {
    receipt: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), delete: vi.fn() },
    tenant: { findFirst: vi.fn() },
    property: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  allocation: { reverseAllocationsForReceipt: vi.fn() },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/allocation/service", () => allocation);

import { DELETE, PUT } from "./route";

const stored = {
  id: "rec-1",
  userId: "user-1",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  leaseId: null,
  amount: 950,
  date: new Date("2026-03-01T00:00:00.000Z"),
  type: "rent",
  status: "pending",
  description: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  tenant: { name: "Ana Costa" },
  property: { name: "Rua Augusta 12" },
};

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://localhost:3000/api/receipts/rec-1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: "rec-1" }) },
  );

describe("PUT /api/receipts/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.receipt.findUnique.mockResolvedValue(stored);
    // Prisma ignores an `undefined` field, so the stand-in must too, or `date: undefined` would
    // wipe the stored date.
    prismaMock.receipt.update.mockImplementation(async ({ data }) => ({
      ...stored,
      ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
    }));
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
  });

  it("refuses a tenant the caller does not own", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const res = await put({ tenantId: "someone-elses-tenant" });

    expect(res.status).toBe(404);
    expect(prismaMock.receipt.update).not.toHaveBeenCalled();
  });

  it("refuses a property the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    const res = await put({ propertyId: "someone-elses-property" });

    expect(res.status).toBe(404);
    expect(prismaMock.receipt.update).not.toHaveBeenCalled();
  });

  // `updateReceiptSchema` was `receiptSchema.partial()`, and Zod 4 still applies a `.default()`
  // inside `.partial()`: an edit that did not mention `status` came back with `status: "paid"`,
  // so correcting a pending receipt's description marked it paid.
  it("leaves the status alone when an update does not send one", async () => {
    const res = await put({ description: "Renda de março" });

    expect(res.status).toBe(200);
    expect(prismaMock.receipt.update.mock.calls[0][0].data.status).toBeUndefined();
  });
});

/**
 * `PaymentAllocation.receipt` is `onDelete: SetNull`, so deleting a receipt used to leave its
 * allocations live: the month it paid still read paid, with no receipt behind it, and no alert
 * chased it. The delete now reverses them first, in the same transaction, the way a void does.
 */
describe("DELETE /api/receipts/[id]", () => {
  const calls: string[] = [];
  const tx = {
    bankTransaction: {
      updateMany: vi.fn(async () => {
        calls.push("movement back to the inbox");
        return { count: 1 };
      }),
    },
    receipt: {
      delete: vi.fn(async () => {
        calls.push("delete");
      }),
    },
  };

  const del = () =>
    DELETE(new NextRequest("http://localhost:3000/api/receipts/rec-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "rec-1" }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    prismaMock.receipt.findUnique.mockResolvedValue(stored);
    prismaMock.receipt.findUniqueOrThrow.mockResolvedValue({ lifecycle: "emitted" });
    prismaMock.$transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) =>
      fn(tx),
    );
    allocation.reverseAllocationsForReceipt.mockImplementation(async () => {
      calls.push("reverse");
      return 1;
    });
  });

  it("takes the payment off the ledger before the receipt goes, in one transaction", async () => {
    const res = await del();

    expect(res.status).toBe(200);
    // Joins the delete's transaction rather than opening its own.
    expect(allocation.reverseAllocationsForReceipt).toHaveBeenCalledWith(
      "rec-1",
      "Receipt deleted",
      tx,
    );
    expect(tx.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { receiptId: "rec-1", userId: "user-1" },
      data: { status: "needs_review" },
    });
    expect(tx.receipt.delete).toHaveBeenCalledWith({ where: { id: "rec-1", userId: "user-1" } });
    // Reversal first: once the receipt is gone, its allocations no longer name it.
    expect(calls).toEqual(["reverse", "movement back to the inbox", "delete"]);
    expect(prismaMock.receipt.delete).not.toHaveBeenCalled();
  });

  it.each(["submitted", "accepted"])(
    "refuses a receipt that is %s at Finanças, and changes nothing",
    async (lifecycle) => {
      prismaMock.receipt.findUniqueOrThrow.mockResolvedValue({ lifecycle });

      const res = await del();

      expect(res.status).toBe(409);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(allocation.reverseAllocationsForReceipt).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for a receipt the caller does not have", async () => {
    prismaMock.receipt.findUnique.mockResolvedValue(null);

    const res = await del();

    expect(res.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
