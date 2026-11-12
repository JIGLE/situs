import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    expense: { findMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prismaMock),
  );
  return { prismaMock };
});
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { generateDueRecurringExpenses } from "./recurring";

const template = {
  id: "tpl-1",
  userId: "user-1",
  propertyId: "prop-1",
  leaseId: null,
  amount: 45,
  date: new Date("2026-09-01T00:00:00.000Z"),
  category: "condominium_fees",
  description: "Condomínio",
  isDeductible: true,
  vendorName: null,
  vendorVat: null,
  isRecurring: true,
  recurrenceRule: "monthly",
  recurrenceDay: 1,
  recurrenceEnd: null,
  recurrenceGeneratedThrough: null as Date | null,
};

describe("generateDueRecurringExpenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.expense.updateMany.mockResolvedValue({ count: 1 });
  });

  it("makes each copy that fell due and moves the template's cursor to the last", async () => {
    prismaMock.expense.findMany.mockResolvedValue([template]);

    const made = await generateDueRecurringExpenses("user-1", new Date("2026-11-12T10:00:00Z"));

    expect(made).toBe(2);
    expect(prismaMock.expense.findMany).toHaveBeenCalledWith({
      where: { isRecurring: true, parentExpenseId: null, userId: "user-1" },
    });
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith({
      where: { id: "tpl-1", recurrenceGeneratedThrough: null },
      data: { recurrenceGeneratedThrough: new Date("2026-11-01T00:00:00.000Z") },
    });
    const { data } = prismaMock.expense.createMany.mock.calls[0][0];
    expect(data.map((c: { date: Date }) => c.date.toISOString().slice(0, 10))).toEqual([
      "2026-10-01",
      "2026-11-01",
    ]);
    expect(data[0]).toMatchObject({
      parentExpenseId: "tpl-1",
      isRecurring: false,
      amount: 45,
      propertyId: "prop-1",
    });
  });

  it("makes nothing again once the cursor is current", async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { ...template, recurrenceGeneratedThrough: new Date("2026-11-01T00:00:00.000Z") },
    ]);

    expect(await generateDueRecurringExpenses("user-1", new Date("2026-11-12"))).toBe(0);
    expect(prismaMock.expense.createMany).not.toHaveBeenCalled();
  });

  it("makes nothing when another run moved the cursor first", async () => {
    prismaMock.expense.findMany.mockResolvedValue([template]);
    prismaMock.expense.updateMany.mockResolvedValue({ count: 0 });

    expect(await generateDueRecurringExpenses("user-1", new Date("2026-11-12"))).toBe(0);
    expect(prismaMock.expense.createMany).not.toHaveBeenCalled();
  });
});
