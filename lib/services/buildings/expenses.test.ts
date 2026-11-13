import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, tx } = vi.hoisted(() => {
  const tx = {
    buildingExpense: { create: vi.fn(), update: vi.fn() },
    expense: { createMany: vi.fn(), deleteMany: vi.fn() },
  };
  return {
    tx,
    prismaMock: {
      building: { findFirst: vi.fn() },
      property: { findMany: vi.fn() },
      buildingExpense: { findFirst: vi.fn(), delete: vi.fn() },
      bankTransaction: { count: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import {
  assertNotBuildingPart,
  createBuildingExpense,
  deleteBuildingExpense,
  updateBuildingExpense,
} from "./expenses";

const INPUT = {
  amount: 120,
  date: "2026-11-01",
  category: "condominium_fees" as const,
  isDeductible: true,
  propertyIds: ["a", "b"],
};

const stored = (parts: { id: string; propertyId: string; amount: number }[]) => ({
  id: "be1",
  buildingId: "b1",
  amount: 120,
  date: new Date("2026-11-01"),
  category: "condominium_fees",
  description: null,
  isDeductible: true,
  vendorName: null,
  vendorVat: null,
  splitBasis: "permilage",
  parts: parts.map((p) => ({ ...p, property: { name: p.propertyId.toUpperCase() } })),
});

describe("building expenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.building.findFirst.mockResolvedValue({ id: "b1", name: "Prédio" });
    tx.buildingExpense.create.mockResolvedValue({ id: "be1" });
    prismaMock.bankTransaction.count.mockResolvedValue(0);
  });

  it("writes each unit's part, by permilagem, as an expense of that unit", async () => {
    prismaMock.property.findMany.mockResolvedValue([
      { id: "a", permilage: 100 },
      { id: "b", permilage: 200 },
    ]);
    prismaMock.buildingExpense.findFirst.mockResolvedValue(
      stored([
        { id: "e1", propertyId: "a", amount: 40 },
        { id: "e2", propertyId: "b", amount: 80 },
      ]),
    );

    const view = await createBuildingExpense("user-1", "b1", INPUT);

    // Only this account's properties, and only those in this building.
    expect(prismaMock.property.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["a", "b"] },
      userId: "user-1",
      buildingId: "b1",
    });
    expect(tx.buildingExpense.create.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      buildingId: "b1",
      amount: 120,
      splitBasis: "permilage",
    });
    expect(tx.expense.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ propertyId: "a", amount: 40, buildingExpenseId: "be1" }),
      expect.objectContaining({ propertyId: "b", amount: 80, buildingExpenseId: "be1" }),
    ]);
    expect(tx.expense.createMany.mock.calls[0][0].data[0]).toMatchObject({
      userId: "user-1",
      category: "condominium_fees",
      isDeductible: true,
    });
    expect(view.parts.map((p) => p.amount)).toEqual([40, 80]);
  });

  it("splits in equal parts when a unit has no permilagem", async () => {
    prismaMock.property.findMany.mockResolvedValue([
      { id: "a", permilage: 100 },
      { id: "b", permilage: null },
    ]);
    prismaMock.buildingExpense.findFirst.mockResolvedValue(stored([]));
    await createBuildingExpense("user-1", "b1", INPUT);
    expect(tx.buildingExpense.create.mock.calls[0][0].data.splitBasis).toBe("equal");
    expect(
      tx.expense.createMany.mock.calls[0][0].data.map((p: { amount: number }) => p.amount),
    ).toEqual([60, 60]);
  });

  it("refuses a unit that is not in the building, or not the caller's", async () => {
    prismaMock.property.findMany.mockResolvedValue([{ id: "a", permilage: 100 }]);
    await expect(createBuildingExpense("user-1", "b1", INPUT)).rejects.toThrow(
      "Every unit must be in this building",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("refuses another account's building", async () => {
    prismaMock.building.findFirst.mockResolvedValue(null);
    await expect(createBuildingExpense("user-2", "b1", INPUT)).rejects.toThrow(
      "Building not found",
    );
  });

  it("rewrites every part on an update", async () => {
    prismaMock.buildingExpense.findFirst.mockResolvedValue(
      stored([{ id: "e1", propertyId: "a", amount: 120 }]),
    );
    prismaMock.property.findMany.mockResolvedValue([
      { id: "a", permilage: 1 },
      { id: "b", permilage: 1 },
    ]);
    await updateBuildingExpense("user-1", "b1", "be1", { ...INPUT, amount: 99.99 });
    expect(tx.expense.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", buildingExpenseId: "be1" },
    });
    expect(
      tx.expense.createMany.mock.calls[0][0].data.map((p: { amount: number }) => p.amount),
    ).toEqual([50, 49.99]);
  });

  it("will not rewrite a part a bank movement paid", async () => {
    prismaMock.buildingExpense.findFirst.mockResolvedValue(
      stored([{ id: "e1", propertyId: "a", amount: 120 }]),
    );
    prismaMock.bankTransaction.count.mockResolvedValue(1);
    await expect(deleteBuildingExpense("user-1", "b1", "be1")).rejects.toMatchObject({
      reason: "building_expense_linked",
    });
    expect(prismaMock.buildingExpense.delete).not.toHaveBeenCalled();
  });

  it("sends a part's own edit to the building", () => {
    expect(() => assertNotBuildingPart({ buildingExpenseId: "be1" })).toThrow(
      expect.objectContaining({ reason: "expense_from_building" }),
    );
    expect(() => assertNotBuildingPart({ buildingExpenseId: null })).not.toThrow();
  });
});
