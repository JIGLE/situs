/**
 * Tenant and property state worked out from the leases and the rent ledger when it is read.
 *
 * `Tenant.propertyId`, `rent`, `leaseStart`, `leaseEnd` and `paymentStatus`, and
 * `Property.status` (occupied or vacant), are copies of what the leases and `RentPeriod` already
 * say. Copies drift: a tenant kept the rent typed when it was created after the lease changed, a
 * property read "occupied" with no lease behind it, and `paymentStatus` moved only when money was
 * allocated, so a month nobody paid left the tenant "paid" after its due date.
 *
 * So every read of a tenant or a property goes through here, and the stored copies are only a
 * fallback for a record no lease names yet. `maintenance` is the owner's own flag, not something a
 * lease says, so it stands.
 */

import { deriveTenantStatus } from "@/lib/services/allocation/engine";
import { periodStatusAt } from "@/lib/services/allocation/rent-matrix";
import type { RentPeriodStatus, TenantPaymentStatus } from "@/lib/services/allocation/types";
import { getPrismaClient } from "./database";

export interface LeaseFacts {
  id: string;
  tenantId: string;
  propertyId: string;
  status: string;
  startDate: Date;
  endDate: Date;
  monthlyRent: number;
}

export interface PeriodFacts {
  tenantId: string;
  status: string;
  dueDate: Date;
  dueAmount: number;
  allocatedAmount: number;
  paidAt: Date | null;
}

/** Lease statuses that still describe a tenancy being set up or running. */
const OPEN_LEASES = new Set(["active", "pending", "draft"]);

/**
 * The lease that describes a tenant now: the active one that started most recently, else an open
 * one not yet active (a draft or pending lease), else the latest of any status. Undefined when the
 * tenant has no lease at all.
 */
export function currentLeaseOf(leases: LeaseFacts[]): LeaseFacts | undefined {
  const latestFirst = [...leases].sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  return (
    latestFirst.find((lease) => lease.status === "active") ??
    latestFirst.find((lease) => OPEN_LEASES.has(lease.status)) ??
    latestFirst[0]
  );
}

/** A tenant's payment status from their rent months as of `now`; null when they have none. */
export function paymentStatusAt(periods: PeriodFacts[], now: Date): TenantPaymentStatus | null {
  if (periods.length === 0) return null;
  return deriveTenantStatus(
    periods.map((period) => periodStatusAt(period, now) as RentPeriodStatus),
  );
}

/** A property is occupied while an active lease on it has started. */
export function isOccupied(leases: LeaseFacts[], now: Date): boolean {
  return leases.some((lease) => lease.status === "active" && lease.startDate <= now);
}

/** What a property's status reads: the owner's `maintenance` flag, else what its leases say. */
export function propertyStatusAt(
  stored: string,
  leases: LeaseFacts[],
  now: Date,
): "occupied" | "vacant" | "maintenance" {
  if (stored === "maintenance") return "maintenance";
  return isOccupied(leases, now) ? "occupied" : "vacant";
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

const LEASE_SELECT = {
  id: true,
  tenantId: true,
  propertyId: true,
  status: true,
  startDate: true,
  endDate: true,
  monthlyRent: true,
} as const;

export interface DerivedTenant {
  propertyId: string | null;
  propertyName: string | null;
  rent: number;
  leaseStart: Date;
  leaseEnd: Date;
  paymentStatus: TenantPaymentStatus;
}

/**
 * What each tenant's lease fields and payment status read, keyed by tenant id. A tenant missing
 * from the map has no lease, and keeps its stored values.
 */
export async function deriveTenants(
  userId: string,
  tenantIds: string[],
  now: Date = new Date(),
): Promise<Map<string, DerivedTenant>> {
  if (tenantIds.length === 0) return new Map();
  const prisma = getPrismaClient();
  const [leases, periods] = await Promise.all([
    prisma.lease.findMany({
      where: { userId, tenantId: { in: tenantIds } },
      select: { ...LEASE_SELECT, property: { select: { name: true } } },
    }),
    prisma.rentPeriod.findMany({
      where: { userId, tenantId: { in: tenantIds } },
      select: {
        tenantId: true,
        status: true,
        dueDate: true,
        dueAmount: true,
        allocatedAmount: true,
        paidAt: true,
      },
    }),
  ]);

  const periodsByTenant = groupBy(periods, (period) => period.tenantId);
  const derived = new Map<string, DerivedTenant>();
  for (const [tenantId, tenantLeases] of groupBy(leases, (lease) => lease.tenantId)) {
    const lease = currentLeaseOf(tenantLeases) as (typeof tenantLeases)[number];
    derived.set(tenantId, {
      propertyId: lease.propertyId,
      propertyName: lease.property?.name ?? null,
      rent: lease.monthlyRent,
      leaseStart: lease.startDate,
      leaseEnd: lease.endDate,
      // No rent month yet (a lease not active, or one that starts later): nothing is owed.
      paymentStatus: paymentStatusAt(periodsByTenant.get(tenantId) ?? [], now) ?? "pending",
    });
  }
  return derived;
}

/** What each property's status reads, keyed by property id. */
export async function derivePropertyStatuses(
  userId: string,
  properties: { id: string; status: string }[],
  now: Date = new Date(),
): Promise<Map<string, "occupied" | "vacant" | "maintenance">> {
  if (properties.length === 0) return new Map();
  const leases = await getPrismaClient().lease.findMany({
    where: { userId, propertyId: { in: properties.map((p) => p.id) }, status: "active" },
    select: LEASE_SELECT,
  });
  const leasesByProperty = groupBy(leases, (lease) => lease.propertyId);
  return new Map(
    properties.map((property) => [
      property.id,
      propertyStatusAt(property.status, leasesByProperty.get(property.id) ?? [], now),
    ]),
  );
}

/** How many of an account's properties are occupied now, by the same rule. */
export async function countOccupied(userId: string, now: Date = new Date()): Promise<number> {
  return getPrismaClient().property.count({
    where: {
      userId,
      status: { not: "maintenance" },
      leases: { some: { status: "active", startDate: { lte: now } } },
    },
  });
}
