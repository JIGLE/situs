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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Leases ending within this many days are counted, as the old dashboard did. */
export const LEASES_ENDING_DAYS = 60;

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
  }[];
  /** What waits for the owner now, whichever month is shown. Each is zero when nothing waits. */
  attention: {
    leasesEnding: number;
    /** What a receipt still needs from the owner: the guided list's count (`/complete`). */
    missingData: number;
  };
  status: {
    /** Null when no bank is connected. */
    bank: { lastSyncAt: string | null; consentEndsAt: string | null; expired: boolean } | null;
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

  const [periods, owed, leasesEnding, connections, at, missing] = await Promise.all([
    prisma.rentPeriod.findMany({
      where: { userId, year, month, status: { not: "waived" } },
      select: { status: true, dueDate: true, dueAmount: true, allocatedAmount: true, paidAt: true },
    }),
    // Every month still owed, whichever month is shown: due already, and not fully paid.
    prisma.rentPeriod.findMany({
      where: { userId, status: { not: "waived" }, paidAt: null, dueDate: { lt: now } },
      select: {
        dueAmount: true,
        allocatedAmount: true,
        lease: {
          select: {
            id: true,
            tenant: { select: { name: true } },
            property: { select: { name: true } },
          },
        },
      },
    }),
    prisma.lease.count({
      where: { userId, status: "active", endDate: { gt: now, lte: endingBy } },
    }),
    prisma.bankConnection.findMany({
      where: { userId, provider: { startsWith: PSD2_PREFIX }, status: { not: "revoked" } },
      select: { status: true, lastSyncAt: true, consentExpiresAt: true },
    }),
    getAtConnection(userId),
    getAttention(userId),
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
    const entry = byLease.get(period.lease.id) ?? {
      leaseId: period.lease.id,
      tenantName: period.lease.tenant.name,
      propertyName: period.lease.property.name,
      months: 0,
      amount: 0,
    };
    entry.months += 1;
    entry.amount = round2(entry.amount + outstanding);
    byLease.set(period.lease.id, entry);
  }
  const late = [...byLease.values()].sort(
    (a, b) => b.amount - a.amount || a.tenantName.localeCompare(b.tenantName, "pt"),
  );

  return {
    year,
    month,
    figures,
    late,
    attention: {
      leasesEnding,
      missingData: missing.counts.total,
    },
    status: { bank: bankStatus(connections, now), taxMode: at.mode },
  };
}

/** The bank's last sync, and the consent that ends first. Null when no bank is connected. */
function bankStatus(
  connections: { status: string; lastSyncAt: Date | null; consentExpiresAt: Date | null }[],
  now: Date,
): DashboardMonth["status"]["bank"] {
  if (connections.length === 0) return null;
  const lastSync = latest(connections.map((c) => c.lastSyncAt));
  const consentEnds = connections
    .map((c) => c.consentExpiresAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return {
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
