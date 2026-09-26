/**
 * The rent ledger read the way the owner asks it: who has paid, month by month.
 *
 * Each month's status is worked out when it is read, with the pure `derivePeriodStatus`. The
 * stored status changes only when money is allocated or reversed, so a month nobody paid stayed
 * "upcoming" after its due date, and the matrix showed a debt as not yet due. The stored value is
 * right for the writes that keep it; it is just not a clock.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { MONEY_EPSILON, round2 } from "@/lib/utils/money";
import { derivePeriodStatus } from "./engine";

interface PeriodFigures {
  status: string;
  dueDate: Date;
  dueAmount: number;
  allocatedAmount: number;
  paidAt: Date | null;
}

/** A period's status as of `now`. `waived` is a decision rather than a date, so it stays. */
export function periodStatusAt(period: PeriodFigures, now: Date): string {
  if (period.status === "waived") return "waived";
  return derivePeriodStatus(
    {
      dueDate: period.dueDate,
      dueAmount: period.dueAmount,
      allocatedAmount: period.allocatedAmount,
      fullyPaidAt: period.paidAt,
    },
    now,
  );
}

/** What is still owed for a period: nothing once it is paid or waived. */
function outstandingOf(period: PeriodFigures): number {
  if (period.status === "waived") return 0;
  return Math.max(0, round2(period.dueAmount - period.allocatedAmount));
}

export interface RentMatrixCell {
  status: string;
  dueAmount: number;
  allocatedAmount: number;
  outstanding: number;
}

export interface MoneyTotals {
  /** Rent owed, waived months left out. */
  expected: number;
  /** Rent allocated to those months, whenever it arrived. */
  received: number;
}

export interface RentMatrixRow {
  leaseId: string;
  tenantId: string;
  propertyId: string;
  tenantName: string;
  propertyName: string;
  leaseStatus: string;
  /** Keyed by month, 1–12. A month the lease has no period for is absent. */
  months: Record<number, RentMatrixCell>;
  totals: MoneyTotals;
}

export interface RentMatrix {
  year: number;
  rows: RentMatrixRow[];
  totals: MoneyTotals & { months: Record<number, MoneyTotals> };
}

function addTo(totals: MoneyTotals, period: PeriodFigures): void {
  if (period.status === "waived") return;
  totals.expected = round2(totals.expected + period.dueAmount);
  totals.received = round2(totals.received + period.allocatedAmount);
}

/** Every lease's twelve months of `year`, sorted by tenant, with totals per row and per month. */
export async function getRentMatrix(
  userId: string,
  year: number,
  now: Date = new Date(),
): Promise<RentMatrix> {
  const periods = await getPrismaClient().rentPeriod.findMany({
    where: { userId, year },
    select: {
      leaseId: true,
      tenantId: true,
      propertyId: true,
      month: true,
      status: true,
      dueDate: true,
      dueAmount: true,
      allocatedAmount: true,
      paidAt: true,
      tenant: { select: { name: true } },
      property: { select: { name: true } },
      lease: { select: { status: true } },
    },
    orderBy: [{ leaseId: "asc" }, { month: "asc" }],
  });

  const rows = new Map<string, RentMatrixRow>();
  const totals: RentMatrix["totals"] = { expected: 0, received: 0, months: {} };

  for (const period of periods) {
    let row = rows.get(period.leaseId);
    if (!row) {
      row = {
        leaseId: period.leaseId,
        tenantId: period.tenantId,
        propertyId: period.propertyId,
        tenantName: period.tenant.name,
        propertyName: period.property.name,
        leaseStatus: period.lease.status,
        months: {},
        totals: { expected: 0, received: 0 },
      };
      rows.set(period.leaseId, row);
    }
    row.months[period.month] = {
      status: periodStatusAt(period, now),
      dueAmount: period.dueAmount,
      allocatedAmount: period.allocatedAmount,
      outstanding: outstandingOf(period),
    };
    addTo(row.totals, period);
    addTo((totals.months[period.month] ??= { expected: 0, received: 0 }), period);
    addTo(totals, period);
  }

  const sorted = [...rows.values()].sort(
    (a, b) =>
      a.tenantName.localeCompare(b.tenantName, "pt") ||
      a.propertyName.localeCompare(b.propertyName, "pt"),
  );
  return { year, rows: sorted, totals };
}

export interface RentMonthPayment {
  amount: number;
  allocatedAt: string;
  receipt: { id: string; date: string; amount: number; lifecycle: string; source: string } | null;
}

export interface RentMonth {
  lease: {
    id: string;
    tenantId: string;
    propertyId: string;
    tenantName: string;
    propertyName: string;
    status: string;
    monthlyRent: number;
  };
  /** Null when the lease has no period for that month: before it started, or never generated. */
  period: {
    year: number;
    month: number;
    status: string;
    dueDate: string;
    dueAmount: number;
    allocatedAmount: number;
    outstanding: number;
    paidAt: string | null;
  } | null;
  /** The live allocations that paid it, oldest first. */
  payments: RentMonthPayment[];
  /**
   * The lease's oldest earlier month still owed. A payment recorded now fills that one first:
   * the waterfall always settles the oldest open month, whichever month the owner tapped.
   */
  olderUnpaid: { year: number; month: number } | null;
}

/** One lease's month, for the month sheet. Null when the lease is not the caller's. */
export async function getRentMonth(
  userId: string,
  leaseId: string,
  year: number,
  month: number,
  now: Date = new Date(),
): Promise<RentMonth | null> {
  const prisma = getPrismaClient();
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, userId },
    select: {
      id: true,
      tenantId: true,
      propertyId: true,
      status: true,
      monthlyRent: true,
      tenant: { select: { name: true } },
      property: { select: { name: true } },
    },
  });
  if (!lease) return null;

  const periods = await prisma.rentPeriod.findMany({
    where: {
      leaseId,
      userId,
      OR: [{ year: { lt: year } }, { year, month: { lte: month } }],
    },
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      dueDate: true,
      dueAmount: true,
      allocatedAmount: true,
      paidAt: true,
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  const target = periods.find((p) => p.year === year && p.month === month) ?? null;
  const older = periods.find((p) => p !== target && outstandingOf(p) > MONEY_EPSILON);

  const allocations = target
    ? await prisma.paymentAllocation.findMany({
        where: { rentPeriodId: target.id, userId, reversedAt: null },
        orderBy: { allocatedAt: "asc" },
        select: {
          amount: true,
          allocatedAt: true,
          receipt: {
            select: { id: true, date: true, amount: true, lifecycle: true, source: true },
          },
        },
      })
    : [];

  return {
    lease: {
      id: lease.id,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      tenantName: lease.tenant.name,
      propertyName: lease.property.name,
      status: lease.status,
      monthlyRent: lease.monthlyRent,
    },
    period: target
      ? {
          year: target.year,
          month: target.month,
          status: periodStatusAt(target, now),
          dueDate: target.dueDate.toISOString(),
          dueAmount: target.dueAmount,
          allocatedAmount: target.allocatedAmount,
          outstanding: outstandingOf(target),
          paidAt: target.paidAt ? target.paidAt.toISOString() : null,
        }
      : null,
    payments: allocations.map((a) => ({
      amount: a.amount,
      allocatedAt: a.allocatedAt.toISOString(),
      receipt: a.receipt
        ? {
            id: a.receipt.id,
            date: a.receipt.date.toISOString().slice(0, 10),
            amount: a.receipt.amount,
            lifecycle: a.receipt.lifecycle,
            source: a.receipt.source,
          }
        : null,
    })),
    olderUnpaid: older ? { year: older.year, month: older.month } : null,
  };
}
