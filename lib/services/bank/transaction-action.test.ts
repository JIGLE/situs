// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the inbox's actions refuse, and why. Each refusal is a typed error with a `reason`, so the
 * route answers 404 or 409 and the screen can say which rule applied. They used to be plain
 * errors that the route turned into a 400 "Internal server error", shown as a lost connection.
 */

const { prismaMock, logAuditMock, allocateReceiptMock } = vi.hoisted(() => ({
  prismaMock: {
    bankTransaction: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
    lease: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
    receipt: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(),
  },
  logAuditMock: vi.fn(),
  allocateReceiptMock: vi.fn(),
}));

const { rememberMock, learnedMock, loggerMock } = vi.hoisted(() => ({
  rememberMock: vi.fn(),
  learnedMock: vi.fn(),
  loggerMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/allocation/service", () => ({ allocateReceipt: allocateReceiptMock }));
vi.mock("@/lib/services/bank/payer-accounts", () => ({
  rememberPayerAccount: rememberMock,
  learnedHashesByTenant: learnedMock,
}));
vi.mock("@/lib/utils/logger", () => ({ logger: loggerMock }));

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
  prismaMock.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.bankTransaction.count.mockResolvedValue(0);
  prismaMock.bankAccount.findFirst.mockResolvedValue({ connection: { metadata: null } });
  prismaMock.lease.findFirst.mockResolvedValue({ id: "lease-1" });
  prismaMock.receipt.findMany.mockResolvedValue([]);
  rememberMock.mockResolvedValue(false);
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

  it("does not hold a test connection's movement for a real payment, as before", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([recordedReceipt]);
    prismaMock.bankAccount.findFirst.mockResolvedValue({
      connection: { metadata: JSON.stringify({ isTest: true }) },
    });

    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-new" });
  });

  it("gives no second receipt to a movement that was settled while the confirmation ran", async () => {
    // A link, or another confirmation, took the movement between this request's read and its write.
    prismaMock.bankTransaction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.receipt.delete.mockResolvedValue({});

    await expect(applyTransactionAction(USER, "txn-1", "confirm")).rejects.toEqual(
      refusal("bank_movement_has_receipt"),
    );

    expect(prismaMock.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: "txn-1", receiptId: null },
      data: { receiptId: "rcpt-new" },
    });
    expect(prismaMock.receipt.delete).toHaveBeenCalledWith({ where: { id: "rcpt-new" } });
    expect(allocateReceiptMock).not.toHaveBeenCalled();
    expect(prismaMock.bankTransaction.update).not.toHaveBeenCalled();
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
  const notFound = expect.objectContaining({ name: "ResourceNotFoundError" });
  const link = (receiptId = "rcpt-recorded") =>
    applyTransactionAction(USER, "txn-1", "link", undefined, { receiptId });

  beforeEach(() => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement());
    // What the inbox could have offered this movement: the lease's payments the query found.
    prismaMock.receipt.findMany.mockResolvedValue([payment]);
  });

  it("takes the recorded payment, allocates nothing, and audits it", async () => {
    expect(await link()).toEqual({ status: "matched_confirmed", receiptId: "rcpt-recorded" });

    expect(prismaMock.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: "txn-1",
        userId: USER,
        receiptId: null,
        status: { in: ["needs_review", "imported"] },
      },
      data: { receiptId: "rcpt-recorded", status: "matched_confirmed" },
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

  it("looks only where the inbox looked: the caller's own paid rent, on the movement's lease", async () => {
    await link();

    expect(prismaMock.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER,
          leaseId: "lease-1",
          type: "rent",
          status: "paid",
          lifecycle: { not: "voided" },
          bankTransactions: { none: {} },
          allocations: { some: { reversedAt: null } },
        }),
      }),
    );
  });

  it("answers not found for a payment that was not offered, whoever's it is", async () => {
    // Not the caller's, on another lease, voided: the query does not return it.
    prismaMock.receipt.findMany.mockResolvedValue([]);
    await expect(link("rcpt-theirs")).rejects.toEqual(notFound);

    // One that was offered, but is not the one named.
    prismaMock.receipt.findMany.mockResolvedValue([payment]);
    await expect(link("rcpt-other")).rejects.toEqual(notFound);

    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("will not link a payment the inbox would not have offered: another amount, or another time", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([{ ...payment, amount: 900 }]);
    await expect(link()).rejects.toEqual(notFound);

    // 31 days before the booking.
    prismaMock.receipt.findMany.mockResolvedValue([
      { ...payment, date: new Date("2026-08-01T00:00:00.000Z") },
    ]);
    await expect(link()).rejects.toEqual(notFound);

    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a payment another movement took while the owner was deciding", async () => {
    prismaMock.bankTransaction.count.mockResolvedValue(1);

    await expect(link()).rejects.toEqual(refusal("bank_payment_already_linked"));
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("refuses when a confirmation overlapped and gave the movement a receipt meanwhile", async () => {
    prismaMock.bankTransaction.updateMany.mockResolvedValue({ count: 0 });

    await expect(link()).rejects.toEqual(refusal("bank_movement_has_receipt"));
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("needs a lease to look in", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ suggestedLeaseId: null }));

    await expect(link()).rejects.toEqual(refusal("bank_lease_required"));
    expect(prismaMock.receipt.findMany).not.toHaveBeenCalled();
  });

  it("refuses to link without saying which payment, and money going out", async () => {
    await expect(applyTransactionAction(USER, "txn-1", "link")).rejects.toEqual(
      refusal("bank_payment_required"),
    );

    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ amount: -850 }));
    await expect(link()).rejects.toEqual(refusal("bank_outflow_not_rent"));
  });

  it("refuses a movement that is not waiting for review", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement({ status: "ignored" }));

    await expect(link()).rejects.toEqual(refusal("bank_movement_not_waiting"));
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("leaves a movement that has another receipt alone, and treats the same link twice as done", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "matched_confirmed", receiptId: "rcpt-other" }),
    );
    await expect(link()).rejects.toEqual(refusal("bank_movement_has_receipt"));

    prismaMock.bankTransaction.findFirst.mockResolvedValue(
      movement({ status: "matched_confirmed", receiptId: "rcpt-recorded" }),
    );
    expect(await link()).toEqual({ status: "matched_confirmed", receiptId: "rcpt-recorded" });
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("never lets sandbox money stand for a real payment, and reads no receipt to find out", async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({
      connection: { metadata: JSON.stringify({ isTest: true }) },
    });

    await expect(link()).rejects.toEqual(refusal("bank_test_movement"));
    expect(prismaMock.receipt.findMany).not.toHaveBeenCalled();
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.bankAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct-1", userId: USER } }),
    );
  });

  it("does not trust an account that is not there", async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue(null);

    await expect(link()).rejects.toEqual(notFound);
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });
});

describe("the account a confirmation came from", () => {
  const ana = () =>
    movement({
      counterpartyIban: "enc:PT50000201231234567890154",
      counterpartyIbanHash: "hash-ana",
    });
  const taught = expect.objectContaining({
    id: "txn-1",
    counterpartyName: "Maria Silva",
    counterpartyIbanHash: "hash-ana",
  });
  const recorded = {
    id: "rcpt-recorded",
    leaseId: "lease-1",
    amount: 850,
    date: new Date("2026-08-30T00:00:00.000Z"),
  };

  beforeEach(() => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(ana());
    prismaMock.lease.findFirst.mockResolvedValue({ id: "lease-1", tenantId: "tenant-1" });
    prismaMock.lease.findUniqueOrThrow.mockResolvedValue({
      tenantId: "tenant-1",
      propertyId: "p1",
    });
    prismaMock.receipt.create.mockResolvedValue({ id: "rcpt-new" });
    rememberMock.mockResolvedValue(true);
  });

  it("is remembered for the tenant of the lease the owner confirmed, and the answer says so", async () => {
    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({
      status: "matched_confirmed",
      receiptId: "rcpt-new",
      remembered: true,
    });
    expect(rememberMock).toHaveBeenCalledWith(USER, "tenant-1", taught);
  });

  it("is remembered for the tenant of the lease the owner assigned it to, not the one suggested", async () => {
    prismaMock.lease.findFirst.mockResolvedValue({ id: "lease-2", tenantId: "tenant-2" });

    await applyTransactionAction(USER, "txn-1", "reassign", "lease-2");

    expect(rememberMock).toHaveBeenCalledWith(USER, "tenant-2", taught);
  });

  it("says nothing of it when the tenant already had that account", async () => {
    rememberMock.mockResolvedValue(false);

    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-new" });
    expect(rememberMock).toHaveBeenCalledTimes(1);
  });

  it("is remembered when the owner links the movement to the payment they recorded", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([recorded]);

    const result = await applyTransactionAction(USER, "txn-1", "link", undefined, {
      receiptId: "rcpt-recorded",
    });

    expect(result).toEqual({
      status: "matched_confirmed",
      receiptId: "rcpt-recorded",
      remembered: true,
    });
    expect(rememberMock).toHaveBeenCalledWith(USER, "tenant-1", taught);
  });

  it("waits while the confirmation waits for the owner to say whether it is new", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([recorded]);

    const held = await applyTransactionAction(USER, "txn-1", "confirm");
    expect(held.status).toBe("needs_review");
    expect(rememberMock).not.toHaveBeenCalled();

    const added = await applyTransactionAction(USER, "txn-1", "confirm", undefined, {
      newPayment: true,
    });
    expect(added.remembered).toBe(true);
    expect(rememberMock).toHaveBeenCalledTimes(1);
  });

  it("is not remembered from a movement with no account to remember", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement());

    await applyTransactionAction(USER, "txn-1", "confirm");

    expect(rememberMock).not.toHaveBeenCalled();
  });

  it("is never remembered from sandbox money", async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({
      connection: { metadata: JSON.stringify({ isTest: true }) },
    });

    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-new" });
    expect(rememberMock).not.toHaveBeenCalled();
  });

  it("is not remembered again from a movement that was confirmed already", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue({
      ...ana(),
      status: "matched_confirmed",
      receiptId: "rcpt-old",
    });

    await applyTransactionAction(USER, "txn-1", "confirm");

    expect(rememberMock).not.toHaveBeenCalled();
  });

  it("never undoes a confirmation when the account cannot be remembered", async () => {
    rememberMock.mockRejectedValue(new Error("database is locked"));

    const result = await applyTransactionAction(USER, "txn-1", "confirm");

    expect(result).toEqual({ status: "matched_confirmed", receiptId: "rcpt-new" });
    expect(allocateReceiptMock).toHaveBeenCalledWith("rcpt-new");
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "A confirmed movement's account could not be remembered",
      { transactionId: "txn-1", error: "database is locked" },
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
