import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: vi.fn() }));

import { calculateDistribution } from "./income-distribution";

const period = {
  propertyId: "property-1",
  periodStart: new Date("2026-01-01"),
  periodEnd: new Date("2026-12-31"),
  calculatedByUserId: "user-1",
};

describe("calculateDistribution", () => {
  it("splits net income — income less expenses — by each owner's share", () => {
    const result = calculateDistribution({
      ...period,
      totalIncome: 12000,
      totalExpenses: 2000,
      owners: [
        { ownerId: "ana", ownerName: "Ana", percentage: 60 },
        { ownerId: "bruno", ownerName: "Bruno", percentage: 40 },
      ],
    });

    expect(result.netIncome).toBe(10000);
    expect(result.shares).toEqual([
      { ownerId: "ana", ownerName: "Ana", percentage: 60, grossShare: 6000 },
      { ownerId: "bruno", ownerName: "Bruno", percentage: 40, grossShare: 4000 },
    ]);
  });

  it("refuses shares that do not add up to 100%", () => {
    expect(() =>
      calculateDistribution({
        ...period,
        totalIncome: 1000,
        totalExpenses: 0,
        owners: [{ ownerId: "ana", ownerName: "Ana", percentage: 60 }],
      }),
    ).toThrow("Owner percentages must sum to 100, got 60.00");
  });
});
