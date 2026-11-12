import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Pins the validation contract: a malformed body is a 400 the caller can act on, not a 500.
 * The route used to call expenseSchema.parse() directly, so the ZodError reached
 * withErrorHandler — which has no ZodError branch and reports everything as 500.
 */

const { requireAuthMock, prismaMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  prismaMock: {
    expense: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    bankTransaction: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    // handlePost now calls assertOwnsRelations, which resolves the body's propertyId
    // against this user before writing. Defaults to "owned"; the refusal case sets it
    // to null explicitly.
    property: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));
import { POST } from "./route";

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/expenses", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const validExpense = {
  propertyId: "prop-1",
  amount: 120.5,
  date: "2026-03-01",
  category: "repairs",
};

describe("POST /api/expenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
    prismaMock.expense.create.mockResolvedValue({
      id: "exp-1",
      amount: 120.5,
      property: { name: "Rua Augusta 12" },
    });
  });

  it("creates an expense from a valid body", async () => {
    const res = await POST(postRequest(validExpense));

    expect(res.status).toBe(201);
    expect(prismaMock.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ propertyId: "prop-1", userId: "user-123" }),
      }),
    );
  });

  // `propertyId` is a body field the schema only checks is a non-empty string. Without an
  // ownership check, an expense could be filed against another landlord's property — a write
  // into their books, from a valid session that simply is not theirs.
  it("returns 404 and writes nothing when the property belongs to someone else", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    const res = await POST(postRequest({ ...validExpense, propertyId: "someone-elses-prop" }));

    expect(res.status).toBe(404);
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the category is not a known one", async () => {
    const res = await POST(postRequest({ ...validExpense, category: "not-a-category" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining("Invalid category") }),
    );
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the amount is zero or negative", async () => {
    const res = await POST(postRequest({ ...validExpense, amount: 0 }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        error: expect.stringContaining("Amount must be greater than 0"),
      }),
    );
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/expenses from a bank movement", () => {
  const movement = {
    id: "txn-1",
    amount: -120.5,
    expenseId: null,
    receiptId: null,
    bankAccount: { connection: { metadata: null } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
    prismaMock.expense.create.mockResolvedValue({
      id: "exp-1",
      amount: 120.5,
      property: { name: "Rua Augusta 12" },
    });
    prismaMock.bankTransaction.findFirst.mockResolvedValue(movement);
    prismaMock.expense.findFirst.mockResolvedValue({ id: "exp-1", bankTransaction: null });
    prismaMock.bankTransaction.updateMany.mockResolvedValue({ count: 1 });
  });

  it("records the expense and links the movement that paid it", async () => {
    const res = await POST(postRequest({ ...validExpense, bankTransactionId: "txn-1" }));

    expect(res.status).toBe(201);
    // The movement is not a column of the expense.
    expect(prismaMock.expense.create.mock.calls[0][0].data).not.toHaveProperty("bankTransactionId");
    expect(prismaMock.bankTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expenseId: "exp-1", status: "matched_confirmed" } }),
    );
    expect((await res.json()).data).toMatchObject({ bankTransactionId: "txn-1" });
  });

  it("writes nothing when the movement cannot pay it", async () => {
    prismaMock.bankTransaction.findFirst.mockResolvedValue({ ...movement, expenseId: "exp-0" });

    const res = await POST(postRequest({ ...validExpense, bankTransactionId: "txn-1" }));

    expect(res.status).toBe(409);
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  it("takes the expense back when the movement was taken meanwhile", async () => {
    prismaMock.bankTransaction.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(postRequest({ ...validExpense, bankTransactionId: "txn-1" }));

    expect(res.status).toBe(409);
    expect(prismaMock.expense.delete).toHaveBeenCalledWith({ where: { id: "exp-1" } });
  });
});
