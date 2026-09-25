// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the inbox's actions refuse, and why. Each refusal is a typed error with a `reason`, so the
 * route answers 404 or 409 and the screen can say which rule applied. They used to be plain
 * errors that the route turned into a 400 "Internal server error", shown as a lost connection.
 */

const { prismaMock, logAuditMock } = vi.hoisted(() => ({
  prismaMock: {
    bankTransaction: { findFirst: vi.fn(), update: vi.fn() },
    lease: { findFirst: vi.fn() },
  },
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/allocation/service", () => ({ allocateReceipt: vi.fn() }));

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
    bookingDate: new Date("2026-09-01"),
    counterpartyName: "Maria Silva",
    ...overrides,
  };
}

const refusal = (reason: string) => expect.objectContaining({ name: "ConflictError", reason });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankTransaction.update.mockResolvedValue({});
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

it("answers not found for a movement that is not the caller's", async () => {
  prismaMock.bankTransaction.findFirst.mockResolvedValue(null);

  await expect(applyTransactionAction(USER, "txn-9", "ignore")).rejects.toEqual(
    expect.objectContaining({ name: "ResourceNotFoundError" }),
  );
  expect(prismaMock.bankTransaction.findFirst).toHaveBeenCalledWith({
    where: { id: "txn-9", userId: USER },
  });
});
