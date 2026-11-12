import { describe, expect, it } from "vitest";
import { expenseYears, summariseYear } from "./expense-year";

const e = (date: string, amount: number, over: Record<string, unknown> = {}) => ({
  propertyId: "p1",
  propertyName: "Rua Augusta 12",
  date,
  amount,
  ...over,
});

describe("expenseYears", () => {
  it("lists every year with an expense, and this one, newest first", () => {
    expect(expenseYears([e("2024-03-01", 1), e("2026-01-01", 1)], new Date("2025-06-01"))).toEqual([
      2026, 2025, 2024,
    ]);
  });
});

describe("summariseYear", () => {
  const expenses = [
    e("2026-11-01T00:00:00.000Z", 45),
    e("2026-10-01T00:00:00.000Z", 45.1),
    e("2026-10-20T00:00:00.000Z", 800, { isDeductible: false }),
    e("2026-04-01", 1200, { propertyId: "p2", propertyName: "Suite 404" }),
    e("2025-12-01", 999),
  ];

  it("totals the year and its deductible part, leaving other years out", () => {
    const year = summariseYear(expenses, 2026);
    expect(year.count).toBe(4);
    expect(year.total).toBe(2090.1);
    expect(year.deductible).toBe(1290.1);
  });

  it("groups by month, newest first, with each month's total", () => {
    const year = summariseYear(expenses, 2026);
    expect(year.months.map((m) => [m.month, m.total, m.items.length])).toEqual([
      [11, 45, 1],
      [10, 845.1, 2],
      [4, 1200, 1],
    ]);
  });

  it("gives each property's total and deductible part", () => {
    const year = summariseYear(expenses, 2026);
    expect(year.byProperty).toEqual([
      { propertyId: "p2", propertyName: "Suite 404", total: 1200, deductible: 1200 },
      { propertyId: "p1", propertyName: "Rua Augusta 12", total: 890.1, deductible: 90.1 },
    ]);
  });
});
