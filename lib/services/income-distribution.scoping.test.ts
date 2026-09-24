import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A standing guard against the IDOR that shipped in the distributions endpoints.
 *
 * `requireAuth` proved a session existed; it never proved whose. `getDistributionHistory` ran
 * `where: { propertyId }` with the id taken straight off a query string, so any signed-in user
 * who knew another landlord's propertyId could read that property's income, expenses and every
 * owner's name, gross share, tax amount and net share. `getAnnualTaxSummary` had the same shape
 * on `ownerId`. `saveDistribution` wrote a distribution — and shares against arbitrary owners —
 * with no ownership check at all.
 *
 * Why these are behavioural tests and not an extension of `app/api/tenant-scoping.test.ts`:
 * that guard skips any route file mentioning `userId`, and `app/api/distributions/route.ts`
 * mentioned it — as `calculatedByUserId`, which is audit metadata and constrains nothing. It
 * also only inspects direct `prisma.<model>.` calls, and these routes delegate to a service.
 * The route passed both checks while being wide open, so a static guard of that shape cannot
 * cover this; asserting on the query actually issued can.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    incomeDistribution: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    incomeDistributionShare: { findMany: vi.fn() },
    property: { findFirst: vi.fn() },
    owner: { findMany: vi.fn(), findFirst: vi.fn() },
    tenant: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => prismaMock,
}));

import {
  getDistributionHistory,
  getAnnualTaxSummary,
  saveDistribution,
} from "./income-distribution";
import { assertOwnsRelations } from "./database/assert-owned";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";

const USER = "user-alice";
const OTHER_PROPERTY = "property-owned-by-bob";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.incomeDistribution.findMany.mockResolvedValue([]);
  prismaMock.incomeDistributionShare.findMany.mockResolvedValue([]);
});

describe("distribution reads are scoped to the caller", () => {
  it("getDistributionHistory constrains the query by the property's owner", async () => {
    await getDistributionHistory(OTHER_PROPERTY, USER);

    const where = prismaMock.incomeDistribution.findMany.mock.calls[0][0].where;
    expect(where.propertyId).toBe(OTHER_PROPERTY);
    // The load-bearing assertion. Without this clause the propertyId alone selects the row,
    // which is exactly what the endpoint did before.
    expect(where.property).toEqual({ userId: USER });
  });

  it("getDistributionHistory keeps the year filter alongside the ownership clause", async () => {
    await getDistributionHistory(OTHER_PROPERTY, USER, 2026);

    const where = prismaMock.incomeDistribution.findMany.mock.calls[0][0].where;
    expect(where.property).toEqual({ userId: USER });
    expect(where.periodStart).toBeDefined();
  });

  it("getAnnualTaxSummary constrains by the owner AND the distribution's property", async () => {
    await getAnnualTaxSummary("owner-of-bob", USER, 2026);

    const where = prismaMock.incomeDistributionShare.findMany.mock.calls[0][0].where;
    expect(where.owner).toEqual({ userId: USER });
    // Both sides on purpose: the second clause also excludes any share row injected against
    // someone else's distribution through the write hole that existed alongside this one.
    expect(where.distribution.property).toEqual({ userId: USER });
  });
});

describe("saveDistribution refuses foreign ids", () => {
  const distribution: Parameters<typeof saveDistribution>[0] = {
    propertyId: OTHER_PROPERTY,
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    totalIncome: 1000,
    totalExpenses: 0,
    netIncome: 1000,
    shares: [{ ownerId: "owner-of-bob", ownerName: "Bob", percentage: 100, grossShare: 1000 }],
    version: 1,
    calculatedAt: new Date(),
    calculatedByUserId: USER,
  };

  it("throws when the property belongs to someone else, and writes nothing", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    await expect(saveDistribution(distribution, USER)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(prismaMock.incomeDistribution.create).not.toHaveBeenCalled();
  });

  it("throws when a share names an owner the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue({ id: OTHER_PROPERTY });
    prismaMock.owner.findMany.mockResolvedValue([]); // requested 1, matched 0

    await expect(saveDistribution(distribution, USER)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(prismaMock.incomeDistribution.create).not.toHaveBeenCalled();
  });

  it("scopes the existing-version lookup too, so version numbers cannot be probed", async () => {
    prismaMock.property.findFirst.mockResolvedValue({ id: OTHER_PROPERTY });
    prismaMock.owner.findMany.mockResolvedValue([{ id: "owner-of-bob" }]);
    prismaMock.incomeDistribution.findFirst.mockResolvedValue(null);
    prismaMock.incomeDistribution.create.mockResolvedValue({ id: "new", shares: [] });

    await saveDistribution(distribution, USER);

    const where = prismaMock.incomeDistribution.findFirst.mock.calls[0][0].where;
    expect(where.property).toEqual({ userId: USER });
  });

  it("checks ownership BEFORE writing, not after", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    await saveDistribution(distribution, USER).catch(() => {});

    expect(prismaMock.property.findFirst).toHaveBeenCalled();
    expect(prismaMock.incomeDistribution.create).not.toHaveBeenCalled();
  });
});

describe("assertOwnsRelations", () => {
  it("rejects each foreign key type it is given", async () => {
    for (const [key, model] of [
      ["propertyId", "property"],
      ["tenantId", "tenant"],
      ["ownerId", "owner"],
    ] as const) {
      vi.clearAllMocks();
      prismaMock[model].findFirst.mockResolvedValue(null);

      await expect(assertOwnsRelations(USER, { [key]: "foreign-id" })).rejects.toBeInstanceOf(
        ResourceNotFoundError,
      );
      expect(prismaMock[model].findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "foreign-id", userId: USER } }),
      );
    }
  });

  it("passes when every supplied id belongs to the caller", async () => {
    prismaMock.property.findFirst.mockResolvedValue({ id: "p" });
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "t" });

    await expect(
      assertOwnsRelations(USER, { propertyId: "p", tenantId: "t" }),
    ).resolves.toBeUndefined();
  });

  it("ignores absent and null ids rather than rejecting them", async () => {
    // Invoices carry all three as optional; a create with only an amount must still work.
    await expect(
      assertOwnsRelations(USER, { propertyId: null, tenantId: undefined }),
    ).resolves.toBeUndefined();
    expect(prismaMock.property.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.tenant.findFirst).not.toHaveBeenCalled();
  });
});
