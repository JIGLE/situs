import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, logAudit, generate } = vi.hoisted(() => ({
  prismaMock: {
    bankTransaction: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    expense: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  logAudit: vi.fn(),
  generate: vi.fn(async () => 0),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit }));
vi.mock("@/lib/services/expenses/recurring", () => ({ generateDueRecurringExpenses: generate }));

import { linkMovementToExpense, linkSureRecurringPayments } from "./bank-expenses";

const realAccount = { connection: { metadata: null } };
const movement = {
  id: "txn-1",
  amount: -45,
  expenseId: null,
  receiptId: null,
  bankAccount: realAccount,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankTransaction.findFirst.mockResolvedValue(movement);
  prismaMock.expense.findFirst.mockResolvedValue({ id: "exp-1", bankTransaction: null });
  prismaMock.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
});

describe("linkMovementToExpense", () => {
  it("links money going out to the caller's expense, only while both are free", async () => {
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).resolves.toEqual({
      status: "matched_confirmed",
      expenseId: "exp-1",
    });
    expect(prismaMock.bankTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "txn-1", userId: "user-1" } }),
    );
    expect(prismaMock.expense.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "exp-1", userId: "user-1" } }),
    );
    expect(prismaMock.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: "txn-1", userId: "user-1", expenseId: null, receiptId: null },
      data: { expenseId: "exp-1", status: "matched_confirmed" },
    });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "LINK_EXPENSE" }));
  });

  it("refuses money coming in, sandbox money, and a movement already linked", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValueOnce({ ...movement, amount: 45 });
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).rejects.toMatchObject({
      reason: "bank_movement_not_outgoing",
    });
    prismaMock.bankTransaction.findFirst.mockResolvedValueOnce({
      ...movement,
      bankAccount: { connection: { metadata: JSON.stringify({ isTest: true }) } },
    });
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).rejects.toMatchObject({
      reason: "bank_test_movement",
    });
    prismaMock.bankTransaction.findFirst.mockResolvedValueOnce({ ...movement, expenseId: "exp-0" });
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).rejects.toMatchObject({
      reason: "bank_movement_linked",
    });
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an expense another movement already paid, or one that is not the caller's", async () => {
    prismaMock.expense.findFirst.mockResolvedValueOnce({
      id: "exp-1",
      bankTransaction: { id: "txn-0" },
    });
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).rejects.toMatchObject({
      reason: "expense_already_linked",
    });
    prismaMock.expense.findFirst.mockResolvedValueOnce(null);
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).rejects.toThrow(/not found/);
  });

  it("says so when another tap took the movement between the read and the write", async () => {
    prismaMock.bankTransaction.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(linkMovementToExpense("user-1", "txn-1", "exp-1")).rejects.toMatchObject({
      reason: "bank_movement_linked",
    });
  });
});

describe("linkSureRecurringPayments", () => {
  const october = {
    counterpartyIbanHash: "v2:condo",
    counterpartyName: "Condominio",
    bookingDate: new Date("2026-10-02"),
    expense: {
      id: "exp-oct",
      amount: 45,
      date: new Date("2026-10-01"),
      parentExpenseId: "tpl",
      vendorVat: null,
      vendorName: null,
      category: "condominium_fees",
      propertyId: "p1",
      isDeductible: true,
    },
  };

  it("links this month's payment to this month's copy once the series has a known payee", async () => {
    prismaMock.bankTransaction.findMany
      .mockResolvedValueOnce([
        {
          id: "txn-1",
          amount: -45,
          bookingDate: new Date("2026-11-03"),
          counterpartyIbanHash: "v2:condo",
          counterpartyName: "Condominio",
        },
      ])
      .mockResolvedValueOnce([october]);
    prismaMock.expense.findMany.mockResolvedValueOnce([
      {
        id: "exp-nov",
        amount: 45,
        date: new Date("2026-11-01"),
        parentExpenseId: "tpl",
        vendorVat: null,
      },
    ]);

    await expect(linkSureRecurringPayments("user-1", "job-1")).resolves.toBe(1);
    expect(generate).toHaveBeenCalledWith("user-1");
    expect(prismaMock.bankTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expenseId: "exp-nov", status: "matched_confirmed" } }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ details: { expenseId: "exp-nov", by: "import" } }),
    );
  });

  it("links nothing the first time a payee is seen", async () => {
    prismaMock.bankTransaction.findMany
      .mockResolvedValueOnce([
        {
          id: "txn-1",
          amount: -45,
          bookingDate: new Date("2026-11-03"),
          counterpartyIbanHash: "v2:condo",
          counterpartyName: "Condominio",
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(linkSureRecurringPayments("user-1", "job-1")).resolves.toBe(0);
    expect(prismaMock.bankTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("never fails the import it runs after", async () => {
    prismaMock.bankTransaction.findMany.mockRejectedValueOnce(new Error("db down"));
    await expect(linkSureRecurringPayments("user-1", "job-1")).resolves.toBe(0);
  });
});
