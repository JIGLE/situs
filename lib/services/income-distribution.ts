/**
 * Income Distribution Service
 *
 * Splits a property's net rental income between its owners by ownership share, with an audit
 * trail for recalculations. Each co-owner declares their own share for IRS, so the split stops
 * at the share: Situs does not estimate anyone's tax.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";
import { sumMoney } from "@/lib/utils/money";

export type DistributionFrequency = "monthly" | "quarterly" | "annually";

export interface OwnerShareConfig {
  ownerId: string;
  ownerName: string;
  percentage: number; // 0-100
}

export interface DistributionInput {
  propertyId: string;
  periodStart: Date;
  periodEnd: Date;
  totalIncome: number;
  totalExpenses: number;
  owners: OwnerShareConfig[];
  calculatedByUserId: string;
}

export interface OwnerDistributionShare {
  ownerId: string;
  ownerName: string;
  percentage: number;
  /** The owner's part of net income (income − expenses), before their own tax. */
  grossShare: number;
}

export interface DistributionResult {
  id?: string;
  propertyId: string;
  periodStart: Date;
  periodEnd: Date;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  shares: OwnerDistributionShare[];
  version: number;
  calculatedAt: Date;
  calculatedByUserId: string;
}

/**
 * Validate that owner percentages sum to 100
 */
function validateOwnerPercentages(owners: OwnerShareConfig[]): void {
  const total = owners.reduce((sum, o) => sum + o.percentage, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new Error(`Owner percentages must sum to 100, got ${total.toFixed(2)}`);
  }
}

/**
 * Calculate income distribution for multiple owners
 */
export function calculateDistribution(input: DistributionInput): DistributionResult {
  validateOwnerPercentages(input.owners);

  const netIncome = input.totalIncome - input.totalExpenses;

  const shares: OwnerDistributionShare[] = input.owners.map((owner) => ({
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    percentage: owner.percentage,
    grossShare: netIncome * (owner.percentage / 100),
  }));

  return {
    propertyId: input.propertyId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalIncome: input.totalIncome,
    totalExpenses: input.totalExpenses,
    netIncome,
    shares,
    version: 1,
    calculatedAt: new Date(),
    calculatedByUserId: input.calculatedByUserId,
  };
}

/**
 * Save distribution to database with audit trail
 */
export async function saveDistribution(
  distribution: DistributionResult,
  userId: string,
): Promise<DistributionResult> {
  const prisma = getPrismaClient();

  // Both the propertyId and every ownerId arrive from the request body, so neither can be
  // trusted. Before this check a caller could write an IncomeDistribution — with amounts of
  // their choosing — against another landlord's property, and attach shares to another
  // landlord's owners. `calculatedByUserId` recorded who did it but constrained nothing.
  //
  // Same shape as app/api/property-owners/route.ts, which already validates both sides.
  const property = await prisma.property.findFirst({
    where: { id: distribution.propertyId, userId },
    select: { id: true },
  });
  if (!property) {
    throw new ResourceNotFoundError("Property not found");
  }

  const ownerIds = [...new Set(distribution.shares.map((s) => s.ownerId))];
  const owners = await prisma.owner.findMany({
    where: { id: { in: ownerIds }, userId },
    select: { id: true },
  });
  if (owners.length !== ownerIds.length) {
    // Deliberately not naming which id failed — that would confirm the existence of ids the
    // caller does not own.
    throw new ResourceNotFoundError("Owner not found");
  }

  // Check for existing distribution in this period. Scoped too: an unscoped read here would
  // let the version counter reveal whether a distribution exists on someone else's property.
  const existing = await prisma.incomeDistribution.findFirst({
    where: {
      propertyId: distribution.propertyId,
      property: { userId },
      periodStart: distribution.periodStart,
      periodEnd: distribution.periodEnd,
    },
    orderBy: { version: "desc" },
  });

  const version = existing ? existing.version + 1 : 1;

  // Create the distribution record
  const created = await prisma.incomeDistribution.create({
    data: {
      propertyId: distribution.propertyId,
      periodStart: distribution.periodStart,
      periodEnd: distribution.periodEnd,
      totalIncome: distribution.totalIncome,
      totalExpenses: distribution.totalExpenses,
      netIncome: distribution.netIncome,
      version,
      calculatedByUserId: distribution.calculatedByUserId,
      recalculatedByUserId: existing ? distribution.calculatedByUserId : null,
      recalculatedAt: existing ? new Date() : null,
      shares: {
        create: distribution.shares.map((share) => ({
          ownerId: share.ownerId,
          ownershipPercentage: share.percentage,
          grossShare: share.grossShare,
          owner: { connect: { id: share.ownerId } },
        })),
      },
    },
    include: {
      shares: true,
    },
  });

  return {
    ...distribution,
    id: created.id,
    version,
  };
}

/**
 * Get distribution history for a property (audit trail).
 *
 * `userId` is REQUIRED and not optional-with-a-default on purpose. This query used to be
 * `where: { propertyId }` with the id coming straight off a query string, so any signed-in
 * user who knew another landlord's propertyId could read that property's full income
 * distribution — income, expenses, and every owner's name, gross share, tax and net share.
 * A session proved someone was logged in; it never proved whose property this was.
 *
 * Scoping lives here rather than only in the route so the compiler enforces it: a future
 * caller cannot forget an argument that does not exist.
 */
export async function getDistributionHistory(
  propertyId: string,
  userId: string,
  year?: number,
): Promise<DistributionResult[]> {
  const prisma = getPrismaClient();
  const whereClause: {
    propertyId: string;
    property: { userId: string };
    periodStart?: { gte: Date; lt: Date };
  } = { propertyId, property: { userId } };

  if (year) {
    whereClause.periodStart = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }

  const distributions = await prisma.incomeDistribution.findMany({
    where: whereClause,
    include: {
      shares: {
        include: {
          owner: true,
        },
      },
    },
    orderBy: [{ periodStart: "desc" }, { version: "desc" }],
  });

  return distributions.map((d) => ({
    id: d.id,
    propertyId: d.propertyId,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    totalIncome: d.totalIncome,
    totalExpenses: d.totalExpenses,
    netIncome: d.netIncome,
    shares: d.shares.map((s) => ({
      ownerId: s.ownerId,
      ownerName: s.owner?.name || "Unknown",
      percentage: s.ownershipPercentage,
      grossShare: s.grossShare,
    })),
    version: d.version,
    calculatedAt: d.createdAt,
    calculatedByUserId: d.calculatedByUserId,
  }));
}

/**
 * One owner's year: their share of each distribution, and the total they declare for IRS.
 *
 * `userId` is required for the same reason as getDistributionHistory — this ran as
 * `where: { ownerId }` against a query-string id and leaked any owner's gross income, tax
 * paid and per-property breakdown to any authenticated caller.
 *
 * Both sides are scoped deliberately. `owner: { userId }` is the semantically correct
 * constraint (it is that owner's summary, and owners belong to a user), while
 * `distribution.property.userId` also excludes any share row that a caller may have injected
 * against someone else's distribution through the POST hole that existed alongside this one.
 */
export async function getAnnualTaxSummary(
  ownerId: string,
  userId: string,
  year: number,
): Promise<{
  ownerId: string;
  year: number;
  totalGrossIncome: number;
  distributions: {
    propertyId: string;
    period: string;
    grossShare: number;
  }[];
}> {
  interface ShareWithDistribution {
    grossShare: number;
    distribution: {
      propertyId: string;
      periodStart: Date;
      periodEnd: Date;
    };
  }

  const prisma = getPrismaClient();
  const shares: ShareWithDistribution[] = await prisma.incomeDistributionShare.findMany({
    where: {
      ownerId,
      owner: { userId },
      distribution: {
        property: { userId },
        periodStart: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    },
    include: {
      distribution: true,
    },
  });

  const distributions = shares.map((s: ShareWithDistribution) => ({
    propertyId: s.distribution.propertyId,
    period: `${s.distribution.periodStart.toISOString().slice(0, 7)} - ${s.distribution.periodEnd.toISOString().slice(0, 7)}`,
    grossShare: s.grossShare,
  }));

  return {
    ownerId,
    year,
    // The owner declares this total — a year of shares summed as Floats drifts, and drift on a
    // declared number is not a rounding curiosity.
    totalGrossIncome: sumMoney(shares.map((s: ShareWithDistribution) => s.grossShare)),
    distributions,
  };
}

export default {
  calculateDistribution,
  saveDistribution,
  getDistributionHistory,
  getAnnualTaxSummary,
};
