/**
 * The dashboard's month, assembled on the server: what was due, what arrived, how far each rent
 * went through the loop (paid → reconciled → receipt → Finanças), and what waits for the owner.
 *
 * Every figure comes from the rent ledger, with each month's status worked out as of `now`
 * (`periodStatusAt`). Never from `Tenant.paymentStatus`, and never from a period's stored
 * status, which changes only when money is allocated: a month nobody paid would still read
 * "upcoming" after its due date.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { getAtConnection } from "@/lib/services/tax/at-connection";
import { periodStatusAt } from "@/lib/services/allocation/rent-matrix";
import { PSD2_PREFIX } from "@/lib/services/bank/providers/registry";
import { MONEY_EPSILON, round2 } from "@/lib/utils/money";

/** A receipt the owner has issued: it left draft and review. */
const ISSUED_LIFECYCLES = new Set(["emitted", "submitted", "accepted"]);
/** A bank movement matched to the payment, by the engine or by the owner. */
const MATCHED_MOVEMENTS = new Set(["auto_matched", "matched_confirmed"]);
/** A filing that reached Finanças. */
const FILED_STATUSES = new Set(["submitted", "accepted"]);
/** Movements still waiting for the owner. */
const MOVEMENTS_TO_REVIEW = new Set(["needs_review", "imported"]);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Leases ending within this many days are counted, as the old dashboard did. */
export const LEASES_ENDING_DAYS = 60;
const RECENT_ITEMS = 5;

export interface DashboardMonth {
  year: number;
  month: number;
  /** The month's rent, waived months left out. */
  figures: { expected: number; received: number; outstanding: number };
  /** How many of the month's rents reached each step of the loop. */
  loop: {
    rents: number;
    paid: number;
    reconciled: number;
    receiptsIssued: number;
    /** Money arrived for the month, and no receipt is issued for it yet. */
    receiptsToIssue: number;
    filed: number;
    fullyProcessed: number;
  };
  /** What waits for the owner now, whichever month is shown. Each is zero when nothing waits. */
  attention: {
    monthsOwed: { count: number; amount: number };
    movementsToReview: number;
    receiptsInDraft: number;
    leasesEnding: number;
  };
  status: {
    /** Null when no bank is connected. */
    bank: { lastSyncAt: string | null; consentEndsAt: string | null; expired: boolean } | null;
    /** The Finanças connector's mode: `sandbox` and `review` send nothing. */
    taxMode: string;
  };
  /** The last bank movements, or the last payments when no bank is connected. */
  recent:
    | {
        source: "bank";
        items: {
          id: string;
          date: string;
          amount: number;
          currency: string;
          counterparty: string | null;
          processed: boolean;
        }[];
      }
    | {
        source: "payments";
        items: { id: string; date: string; amount: number; tenantName: string }[];
      };
  portfolio: { properties: number; occupied: number; leasesEnding: number };
  /** The last audit entries, newest first. */
  activity: { id: string; action: string; resourceType: string | null; createdAt: string }[];
}

export async function getDashboardMonth(
  userId: string,
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<DashboardMonth> {
  const prisma = getPrismaClient();
  const endingBy = new Date(now.getTime() + LEASES_ENDING_DAYS * DAY_MS);

  const [
    periods,
    owed,
    movementsToReview,
    receiptsInDraft,
    leasesEnding,
    properties,
    occupied,
    connections,
    activity,
    at,
  ] = await Promise.all([
    prisma.rentPeriod.findMany({
      where: { userId, year, month, status: { not: "waived" } },
      select: {
        status: true,
        dueDate: true,
        dueAmount: true,
        allocatedAmount: true,
        paidAt: true,
        allocations: {
          where: { reversedAt: null },
          select: {
            receipt: {
              select: { lifecycle: true, bankTransactions: { select: { status: true } } },
            },
          },
        },
        rentReceiptFilings: { select: { status: true } },
      },
    }),
    // Every month still owed, whichever month is shown: due already, and not fully paid.
    prisma.rentPeriod.findMany({
      where: { userId, status: { not: "waived" }, paidAt: null, dueDate: { lt: now } },
      select: { dueAmount: true, allocatedAmount: true },
    }),
    // Money in only, as the inbox's default filter: money going out is never work.
    prisma.bankTransaction.count({
      where: { userId, status: "needs_review", amount: { gt: 0 } },
    }),
    prisma.receipt.count({ where: { userId, lifecycle: { in: ["draft", "review"] } } }),
    prisma.lease.count({
      where: { userId, status: "active", endDate: { gt: now, lte: endingBy } },
    }),
    prisma.property.count({ where: { userId } }),
    prisma.property.count({ where: { userId, status: "occupied" } }),
    prisma.bankConnection.findMany({
      where: { userId, provider: { startsWith: PSD2_PREFIX }, status: { not: "revoked" } },
      select: { status: true, lastSyncAt: true, consentExpiresAt: true },
    }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_ITEMS,
      select: { id: true, action: true, resourceType: true, createdAt: true },
    }),
    getAtConnection(userId),
  ]);

  const figures = { expected: 0, received: 0, outstanding: 0 };
  const loop = {
    rents: 0,
    paid: 0,
    reconciled: 0,
    receiptsIssued: 0,
    receiptsToIssue: 0,
    filed: 0,
    fullyProcessed: 0,
  };
  for (const period of periods) {
    figures.expected = round2(figures.expected + period.dueAmount);
    figures.received = round2(figures.received + period.allocatedAmount);
    figures.outstanding = round2(
      figures.outstanding + Math.max(0, period.dueAmount - period.allocatedAmount),
    );

    const status = periodStatusAt(period, now);
    const receipts = period.allocations.flatMap((allocation) =>
      allocation.receipt ? [allocation.receipt] : [],
    );
    const paid = status === "paid" || status === "paid_late";
    const reconciled =
      paid &&
      receipts.some((receipt) =>
        receipt.bankTransactions.some((movement) => MATCHED_MOVEMENTS.has(movement.status)),
      );
    const issued = receipts.some((receipt) => ISSUED_LIFECYCLES.has(receipt.lifecycle));
    const filed = period.rentReceiptFilings.some((filing) => FILED_STATUSES.has(filing.status));

    loop.rents += 1;
    if (paid) loop.paid += 1;
    if (reconciled) loop.reconciled += 1;
    if (issued) loop.receiptsIssued += 1;
    else if (period.allocatedAmount > MONEY_EPSILON) loop.receiptsToIssue += 1;
    if (filed) loop.filed += 1;
    if (paid && reconciled && issued && filed) loop.fullyProcessed += 1;
  }

  const monthsOwed = { count: 0, amount: 0 };
  for (const period of owed) {
    const outstanding = round2(period.dueAmount - period.allocatedAmount);
    if (outstanding <= MONEY_EPSILON) continue;
    monthsOwed.count += 1;
    monthsOwed.amount = round2(monthsOwed.amount + outstanding);
  }

  return {
    year,
    month,
    figures,
    loop,
    attention: { monthsOwed, movementsToReview, receiptsInDraft, leasesEnding },
    status: { bank: bankStatus(connections, now), taxMode: at.mode },
    recent: await recentMoney(userId, connections.length > 0),
    portfolio: { properties, occupied, leasesEnding },
    activity: activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      resourceType: entry.resourceType,
      createdAt: entry.createdAt.toISOString(),
    })),
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

/** The last bank movements when a bank is connected; otherwise the last payments recorded. */
async function recentMoney(userId: string, bankConnected: boolean) {
  const prisma = getPrismaClient();
  if (bankConnected) {
    const movements = await prisma.bankTransaction.findMany({
      where: { userId },
      orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
      take: RECENT_ITEMS,
      select: {
        id: true,
        bookingDate: true,
        amount: true,
        currency: true,
        counterpartyName: true,
        status: true,
      },
    });
    return {
      source: "bank" as const,
      items: movements.map((movement) => ({
        id: movement.id,
        date: movement.bookingDate.toISOString(),
        amount: movement.amount,
        currency: movement.currency,
        counterparty: movement.counterpartyName,
        processed: !MOVEMENTS_TO_REVIEW.has(movement.status),
      })),
    };
  }
  const payments = await prisma.receipt.findMany({
    where: { userId, status: "paid" },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: RECENT_ITEMS,
    select: { id: true, date: true, amount: true, tenant: { select: { name: true } } },
  });
  return {
    source: "payments" as const,
    items: payments.map((payment) => ({
      id: payment.id,
      date: payment.date.toISOString(),
      amount: payment.amount,
      tenantName: payment.tenant.name,
    })),
  };
}
