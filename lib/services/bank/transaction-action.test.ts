// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the inbox's actions refuse, and why. Each refusal is a typed error with a `reason`, so the
 * route answers 404 or 409 and the screen can say which rule applied. They used to be plain
 * errors that the route turned into a 400 "Internal server error", shown as a lost connection.
 */

const { prismaMock, logAuditMock, allocateReceiptMock } = vi.hoisted(() => ({
  prismaMock: {
    bankTransaction: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
    lease: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
    receipt: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  logAuditMock: vi.fn(),
  allocateReceiptMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/allocation/service", () => ({ allocateReceipt: allocateReceiptMock }));

import { applyTransactionAction } from "./import";

const USER = "user-1";

function movement(overrides: Record<string, unknown> = {}) {
  return {
    id: "txn-1",
    userId: USER,
    amount: 850,
    status: "needs_review",
    suggestedLeaseId: "lease-1",
    receiptId: null,
    bankAccountId: "acct-1",
    bookingDate: new Date("2026-09-01"),
    counterpartyName: "Maria Silva",
    ...overrides,
  };
}

const refusal = (reason: string) => expect.objectContaining({ name: "ConflictError", reason });

beforeEach(() => {
  // `clearAllMocks` keeps implementations, so every default a test may change is set here.
  vi.clearAllMocks();
  prismaMock.bankTransaction.update.mockResolvedValue({});
  prismaMock.bankTransaction.count.mockResolvedValue(0);
  prismaMock.bankAccount.findFirst.mockResolvedValue({ connection: { metadata: null } });
  prismaMock.lease.findFirst.mockResolvedValue({ id: "lease-1" });
  prismaMock.receipt.findMany.mockResolvedValue([]);
  prismaMock.receipt.findFirst.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (work: (tx: typeof prismaMock) => unknown) =>
    work(prismaMock),
  );
});

describe("restore", () => {
  it("takes an ignored movement back to review, and audits it", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ status: "ignored" }));

    const result = await applyTransactionAction(USER, "txn-1", "restore");

    expect(result).toEqual({ status: "needs_review", receiptId: null });
    expect(prismaMock.bankTransaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { status: "needs_review" },
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RESTORE_TRANSACTION", resourceId: "txn-1" }),
    );
  });

  it("refuses a movement that was not ignored", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ status: "auto_matched" }));

    await expect(applyTransactionAction(USER, "txn-1", "restore")).rejects.toEqual(
      refusal("bank_movement_not_ignored"),
    );
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
  });

  it("refuses a movement that has a receipt", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "ignored", receiptId: "rcpt-1" }),
    );

    await expect(applyTransactionAction(USER, "txn-1", "restore")).rejects.toEqual(
      refusal("bank_movement_has_receipt"),
    );
  });
});

describe("ignore", () => {
  it("parks a movement waiting for review", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement());

    expect(await applyTransactionAction(USER, "txn-1", "ignore")).toEqual({
      status: "ignored",
      receiptId: null,
    });
  });

  it("refuses a movement whose receipt would stay allocated behind it", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "matched_confirmed", receiptId: "rcpt-1" }),
    );

    await expect(applyTransactionAction(USER, "txn-1", "ignore")).rejects.toEqual(
      refusal("bank_movement_has_receipt"),
    );
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
  });
});

describe("confirm", () => {
  it("refuses money going out", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ amount: -60 }));

    await expect(applyTransactionAction(USER, "txn-1", "confirm")).rejects.toEqual(
      refusal("bank_outflow_not_rent"),
    );
  });

  it("refuses a movement with no contract to confirm it against", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ suggestedLeaseId: null }));

    await expect(applyTransactionAction(USER, "txn-1", "confirm")).rejects.toEqual(
      refusal("bank_lease_required"),
    );
  });

  it("answers not found for another owner's contract", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement());
    prismaMock.lease.findFirst.mockResolvedValue(null);

    await expect(applyTransactionAction(USER, "txn-1", "confirm")).rejects.toEqual(
      expect.objectContaining({ name: "ResourceNotFoundError" }),
    );
    expect(prismaMock.lease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lease-1", userId: USER } }),
    );
  });
});

/**
 * A payment the owner already recorded by hand is not allocated a second time.
 *
 * Confirming or assigning a movement used to create a receipt and run the waterfall whatever the
 * lease already had, so the bank's copy of a payment the owner had recorded paid the next month.
 * When the lease has a payment recorded for this amount around this date, the movement now waits
 * with the lease the owner chose, and the answer carries the recorded payments.
 */
describe("confirm and reassign, when the lease has a payment recorded for this money", () => {
  const recordedReceipt = {
    id: "rcpt-recorded",
    leaseId: "lease-1",
    amount: 850,
    date: new Date("2026-08-30T00:00:00.000Z"),
  };

  beforeEach(() => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement());
    prismaMock.lease.findUniqueOrThrow.mockResolvedValue({ tenantId: "t1", propertyId: "p1" });
    prismaMock.receipt.create.mockResolvedValue({ id: "rcpt-new" });
  });

  it("creates the receipt as before when nothing was recorded", async () => {
    // Load-bearing precondition: without it every hold assertion below could pass on a fixture
    // that never reached the allocation.
    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-new" });
    expect(allocateReceiptMock).toHaveBeenCalledWith("rcpt-new");
  });

  it("waits instead of allocating, and gives the owner the payments it may be", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([recordedReceipt]);

    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({
      status: "needs_review",
      receiptId: null,
      recordedPayments: [{ id: "rcpt-recorded", date: "2026-08-30", amount: 850 }],
    });
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
    expect(allocateReceiptMock).not.toHaveBeenCalled();
    expect(prismaMock.bankTransaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { status: "needs_review", suggestedLeaseId: "lease-1" },
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("looks at the payments of the caller on the lease the owner chose, and keeps that lease", async () => {
    prismaMock.lease.findFirst.mockResolvedValue({ id: "lease-2" });
    prismaMock.receipt.findMany.mockResolvedValue([{ ...recordedReceipt, leaseId: "lease-2" }]);

    const result = await applyTransactionAction(USER, "txn-1", "reassign", "lease-2");

    expect(result.recordedPayments).toHaveLength(1);
    expect(prismaMock.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER, leaseId: "lease-2" }),
      }),
    );
    expect(prismaMock.bankTransaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: { status: "needs_review", suggestedLeaseId: "lease-2" },
    });
  });

  it("allocates when the owner says it is a new payment, and does not ask again", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([recordedReceipt]);

    const result = await applyTransactionAction(USER, "txn-1", "confirm", undefined, {
      newPayment: true,
    });

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-new" });
    expect(prismaMock.receipt.findMany).not.toHaveBeenCalled();
    expect(allocateReceiptMock).toHaveBeenCalledWith("rcpt-new");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "CONFIRM_MATCH" }));
  });

  it("does not look when the movement already has its receipt", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([recordedReceipt]);
    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "auto_matched", receiptId: "rcpt-auto" }),
    );

    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-auto" });
    expect(prismaMock.receipt.findMany).not.toHaveBeenCalled();
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
  });
});

/**
 * Linking: the owner says the movement IS the payment they recorded. The receipt already counts,
 * so nothing is allocated; the movement takes the receipt, and the month it paid is reconciled.
 */
describe("link", () => {
  const payment = {
    id: "rcpt-recorded",
    leaseId: "lease-1",
    amount: 850,
    date: new Date("2026-08-30T00:00:00.000Z"),
  };

  beforeEach(() => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement());
    prismaMock.receipt.findFirst.mockResolvedValue(payment);
  });

  it("takes the recorded payment, allocates nothing, and audits it", async () => {
    const result = await applyTransactionAction(USER, "txn-1", "link", undefined, {
      receiptId: "rcpt-recorded",
    });

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-recorded" });
    expect(prismaMock.bankTransaction.update).toHaveBeenCalledWith({
      where: { id: "txn-1" },
      data: {
        receiptId: "rcpt-recorded",
        status: "matched_confirmed",
        suggestedLeaseId: "lease-1",
      },
    });
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
    expect(allocateReceiptMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith({
      userId: USER,
      action: "LINK_PAYMENT",
      resourceType: "bank_transaction",
      resourceId: "txn-1",
      details: { receiptId: "rcpt-recorded", leaseId: "lease-1", amount: 850 },
    });
  });

  it("reads only the caller's own paid rent that counts and has no movement", async () => {
    await applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" });

    expect(prismaMock.receipt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "rcpt-recorded",
          userId: USER,
          type: "rent",
          status: "paid",
          lifecycle: { not: "voided" },
          bankTransactions: { none: {} },
          allocations: { some: { reversedAt: null } },
        }),
      }),
    );
  });

  it("answers not found for a payment that is not the caller's, or that cannot be linked", async () => {
    prismaMock.receipt.findFirst.mockResolvedValue(null);

    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-theirs" }),
    ).rejects.toEqual(expect.objectContaining({ name: "ResourceNotFoundError" }));
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
  });

  it("refuses a payment of another amount", async () => {
    prismaMock.receipt.findFirst.mockResolvedValue({ ...payment, amount: 900 });

    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" }),
    ).rejects.toEqual(refusal("bank_payment_amount_differs"));
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
  });

  it("refuses a payment another movement took while the owner was deciding", async () => {
    prismaMock.bankTransaction.count.mockResolvedValue(1);

    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" }),
    ).rejects.toEqual(refusal("bank_payment_already_linked"));
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("refuses to link without saying which payment, and money going out", async () => {
    await expect(applyTransactionAction(USER, "txn-1", "link")).rejects.toEqual(
      refusal("bank_payment_required"),
    );

    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ amount: -850 }));
    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" }),
    ).rejects.toEqual(refusal("bank_outflow_not_rent"));
  });

  it("refuses a movement that is not waiting for review", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ status: "ignored" }));

    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" }),
    ).rejects.toEqual(refusal("bank_movement_not_waiting"));
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
  });

  it("leaves a movement that has another receipt alone, and treats the same link twice as done", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "matched_confirmed", receiptId: "rcpt-other" }),
    );
    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" }),
    ).rejects.toEqual(refusal("bank_movement_has_receipt"));

    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "matched_confirmed", receiptId: "rcpt-recorded" }),
    );
    expect(
      await applyTransactionAction(USER, "txn-1", "link", undefined, {
        receiptId: "rcpt-recorded",
      }),
    ).toEqual({ status: "matched_confirmed", receiptId: "rcpt-recorded" });
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
  });

  it("never lets sandbox money stand for a real payment", async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({
      connection: { metadata: JSON.stringify({ isTest: true }) },
    });

    await expect(
      applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId: "rcpt-recorded" }),
    ).rejects.toEqual(refusal("bank_test_movement"));
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
    expect(prismaMock.bankAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct-1", userId: USER } }),
    );
  });
});

it("answers not found for a movement that is not the caller's", async () => {
  prismaMock.bankTransaction.findFirst.mockResolvedValue(null);

  await expect(applyTransactionAction(USER, "txn-9", "ignore")).rejects.toEqual(
    expect.objectContaining({ name: "ResourceNotFoundError" }),
  );
  expect(prismaMock.bankTransaction.findFirst).toHaveBeenCalledWith({
    where: { id: "txn-9", userId: USER },
  });
});
