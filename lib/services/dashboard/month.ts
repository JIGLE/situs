/**
 * The dashboard's month, assembled on the server: what was due, what arrived, who is late and
 * what else waits for the owner. The payments to confirm and the receipts to issue are the Home
 * inbox's, which reads them itself.
 *
 * Every figure comes from the rent ledger's amounts, and a month is owed when it fell due before
 * `now` unpaid. Never from `Tenant.paymentStatus`, and never from a period's stored status, which
 * changes only when money is allocated: a month nobody paid would still read "upcoming" after
 * its due date.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { getAttention } from "@/lib/services/attention/gather";
import { getAtConnection } from "@/lib/services/tax/at-connection";
import { PSD2_PREFIX } from "@/lib/services/bank/providers/registry";
import { MONEY_EPSILON, round2 } from "@/lib/utils/money";
import { periodStatusAt } from "@/lib/services/allocation/rent-matrix";
import type { RentPeriodStatus } from "@/lib/services/allocation/types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Leases ending within this many days are counted, as the old dashboard did. */
export const LEASES_ENDING_DAYS = 60;
/** Rent falling due within this many days is listed under what comes next. */
export const UPCOMING_DAYS = 30;

export interface DashboardMonth {
  year: number;
  month: number;
  /** The month's rent, waived months left out. */
  figures: { expected: number; received: number; outstanding: number };
  /**
   * Each tenancy with a month still owed, whichever month is shown: the rent due and not fully
   * paid, most owed first.
   */
  late: {
    leaseId: string;
    tenantName: string;
    propertyName: string;
    months: number;
    amount: number;
    /** The oldest month still owed, as `YYYY-MM`. */
    since: string;
  }[];
  /**
   * The shown month, one row per tenancy: what it owes, what arrived and when, and its status as
   * of `now` (`periodStatusAt`), so a month nobody paid reads overdue after its due date.
   */
  tenancies: {
    leaseId: string;
    tenantName: string;
    propertyName: string;
    status: RentPeriodStatus;
    dueDate: string;
    dueAmount: number;
    allocatedAmount: number;
    paidAt: string | null;
  }[];
  /** The shown month's year: rent received for its months, and expenses dated in it. */
  yearTotals: { received: number; expenses: number };
  /**
   * What comes next, from `now`, soonest first: rent falling due in the next UPCOMING_DAYS, rent
   * increases starting and contracts reaching their term in the next LEASES_ENDING_DAYS.
   */
  upcoming: (
    | { kind: "rent"; date: string; leaseId: string; tenantName: string; amount: number }
    | {
        kind: "increase";
        date: string;
        leaseId: string;
        tenantName: string;
        previousRent: number;
        newRent: number;
      }
    | { kind: "leaseEnd"; date: string; leaseId: string; tenantName: string; autoRenew: boolean }
  )[];
  /** What waits for the owner now, whichever month is shown. Each is zero when nothing waits. */
  attention: {
    leasesEnding: number;
    /** What a receipt still needs from the owner: the guided list's count (`/complete`). */
    missingData: number;
  };
  status: {
    /** Null when no bank is connected. */
    bank: {
      /** The owner's name for the bank, or the bank's own; the first one when several. */
      name: string;
      lastSyncAt: string | null;
      consentEndsAt: string | null;
      expired: boolean;
    } | null;
    /** The Finanças connector's mode: `sandbox` and `review` send nothing. */
    taxMode: string;
  };
}

export async function getDashboardMonth(
  userId: string,
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<DashboardMonth> {
  const prisma = getPrismaClient();
  const endingBy = new Date(now.getTime() + LEASES_ENDING_DAYS * DAY_MS);

  const dueBy = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
  const leaseNames = {
    select: {
      id: true,
      tenant: { select: { name: true } },
      property: { select: { name: true } },
    },
  } as const;

  const [
    periods,
    owed,
    leasesEnding,
    connections,
    at,
    missing,
    yearRent,
    yearExpenses,
    dueSoon,
    increases,
    ending,
  ] = await Promise.all([
    prisma.rentPeriod.findMany({
      where: { userId, year, month, status: { not: "waived" } },
      select: {
        status: true,
        dueDate: true,
        dueAmount: true,
        allocatedAmount: true,
        paidAt: true,
        lease: leaseNames,
      },
    }),
    // Every month still owed, whichever month is shown: due already, and not fully paid.
    prisma.rentPeriod.findMany({
      where: { userId, status: { not: "waived" }, paidAt: null, dueDate: { lt: now } },
      select: {
        year: true,
        month: true,
        dueAmount: true,
        allocatedAmount: true,
        lease: leaseNames,
      },
    }),
    prisma.lease.count({
      where: { userId, status: "active", endDate: { gt: now, lte: endingBy } },
    }),
    prisma.bankConnection.findMany({
      where: { userId, provider: { startsWith: PSD2_PREFIX }, status: { not: "revoked" } },
      select: {
        status: true,
        lastSyncAt: true,
        consentExpiresAt: true,
        label: true,
        institutionName: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    getAtConnection(userId),
    getAttention(userId),
    prisma.rentPeriod.aggregate({
      where: { userId, year, status: { not: "waived" } },
      _sum: { allocatedAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, date: { gte: yearStart, lt: nextYearStart } },
      _sum: { amount: true },
    }),
    prisma.rentPeriod.findMany({
      where: { userId, status: { not: "waived" }, paidAt: null, dueDate: { gte: now, lte: dueBy } },
      select: { dueDate: true, dueAmount: true, allocatedAmount: true, lease: leaseNames },
    }),
    prisma.rentIncrease.findMany({
      where: { userId, appliedAt: null, effectiveFrom: { gte: now, lte: endingBy } },
      select: {
        effectiveFrom: true,
        previousRent: true,
        newRent: true,
        lease: { select: { id: true, tenant: { select: { name: true } } } },
      },
    }),
    prisma.lease.findMany({
      where: { userId, status: "active", endDate: { gt: now, lte: endingBy } },
      select: { id: true, endDate: true, autoRenew: true, tenant: { select: { name: true } } },
    }),
  ]);

  const figures = { expected: 0, received: 0, outstanding: 0 };
  for (const period of periods) {
    figures.expected = round2(figures.expected + period.dueAmount);
    figures.received = round2(figures.received + period.allocatedAmount);
    figures.outstanding = round2(
      figures.outstanding + Math.max(0, period.dueAmount - period.allocatedAmount),
    );
  }

  const byLease = new Map<string, DashboardMonth["late"][number]>();
  for (const period of owed) {
    const outstanding = round2(period.dueAmount - period.allocatedAmount);
    if (outstanding <= MONEY_EPSILON) continue;
    const key = `${period.year}-${String(period.month).padStart(2, "0")}`;
    const entry = byLease.get(period.lease.id) ?? {
      leaseId: period.lease.id,
      tenantName: period.lease.tenant.name,
      propertyName: period.lease.property.name,
      months: 0,
      amount: 0,
      since: key,
    };
    if (key < entry.since) entry.since = key;
    entry.months += 1;
    entry.amount = round2(entry.amount + outstanding);
    byLease.set(period.lease.id, entry);
  }
  const late = [...byLease.values()].sort(
    (a, b) => b.amount - a.amount || a.tenantName.localeCompare(b.tenantName, "pt"),
  );

  const tenancies = periods
    .map((period) => ({
      leaseId: period.lease.id,
      tenantName: period.lease.tenant.name,
      propertyName: period.lease.property.name,
      status: periodStatusAt(period, now),
      dueDate: period.dueDate.toISOString(),
      dueAmount: period.dueAmount,
      allocatedAmount: period.allocatedAmount,
      paidAt: period.paidAt ? period.paidAt.toISOString() : null,
    }))
    .sort((a, b) => a.tenantName.localeCompare(b.tenantName, "pt"));

  const upcoming: DashboardMonth["upcoming"] = [
    ...dueSoon
      .map((period) => ({
        kind: "rent" as const,
        date: period.dueDate.toISOString(),
        leaseId: period.lease.id,
        tenantName: period.lease.tenant.name,
        amount: round2(period.dueAmount - period.allocatedAmount),
      }))
      .filter((item) => item.amount > MONEY_EPSILON),
    ...increases.map((increase) => ({
      kind: "increase" as const,
      date: increase.effectiveFrom.toISOString(),
      leaseId: increase.lease.id,
      tenantName: increase.lease.tenant.name,
      previousRent: increase.previousRent,
      newRent: increase.newRent,
    })),
    ...ending.map((lease) => ({
      kind: "leaseEnd" as const,
      date: lease.endDate.toISOString(),
      leaseId: lease.id,
      tenantName: lease.tenant.name,
      autoRenew: lease.autoRenew,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    year,
    month,
    figures,
    late,
    tenancies,
    yearTotals: {
      received: round2(yearRent._sum.allocatedAmount ?? 0),
      expenses: round2(yearExpenses._sum.amount ?? 0),
    },
    upcoming,
    attention: {
      leasesEnding,
      missingData: missing.counts.total,
    },
    status: { bank: bankStatus(connections, now), taxMode: at.mode },
  };
}

/** The bank's last sync, and the consent that ends first. Null when no bank is connected. */
function bankStatus(
  connections: {
    status: string;
    lastSyncAt: Date | null;
    consentExpiresAt: Date | null;
    label: string | null;
    institutionName: string;
  }[],
  now: Date,
): DashboardMonth["status"]["bank"] {
  if (connections.length === 0) return null;
  const first = connections[0];
  const lastSync = latest(connections.map((c) => c.lastSyncAt));
  const consentEnds = connections
    .map((c) => c.consentExpiresAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    name: first.label || first.institutionName,
    lastSyncAt: lastSync ? lastSync.toISOString() : null,
    consentEndsAt: consentEnds ? consentEnds.toISOString() : null,
    expired:
      connections.some((c) => c.status === "expired") ||
      (consentEnds !== undefined && consentEnds.getTime() <= now.getTime()),
  };
}

function latest(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>(
    (found, date) => (date && (!found || date > found) ? date : found),
    null,
  );
}
