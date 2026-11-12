/**
 * Situs allocation engine — pure reference-month waterfall.
 *
 * The product rules ("a current tenant's June 1 payment refers to July;
 * a tenant in arrears settles the oldest unpaid month first; partials fill
 * partially; overpayments carry forward") collapse to ONE invariant:
 *
 *   Always fill the oldest not-fully-allocated period, waterfall forward,
 *   creating future periods as needed.
 *
 * No IO, no Prisma: the service layer applies plans inside a transaction
 * and is responsible for idempotency (no live allocations for the source
 * payment) and for recomputing persisted statuses via the helpers below.
 */

import type {
  AllocationEntry,
  AllocationPlan,
  AllocationWarning,
  PeriodRef,
  PlanAllocationInput,
  RentPeriodStatus,
  TenantPaymentStatus,
} from "./types";
import { MONEY_EPSILON, round2 } from "@/lib/utils/money";

// Half a cent — float-safe "zero" for EUR amounts. Shared with the tax and reporting
// paths via lib/utils/money.ts so the discipline is defined in one place.
const EPSILON = MONEY_EPSILON;

function periodIndex(p: PeriodRef): number {
  return p.year * 12 + (p.month - 1);
}

function refFromIndex(index: number): PeriodRef {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function comparePeriods(a: PeriodRef, b: PeriodRef): number {
  return periodIndex(a) - periodIndex(b);
}

/** First day of a reference month, UTC — the default due date convention. */
export function periodDueDate(p: PeriodRef): Date {
  return new Date(Date.UTC(p.year, p.month - 1, 1));
}

export function planAllocation(input: PlanAllocationInput): AllocationPlan {
  const { payment } = input;
  const warnings: AllocationWarning[] = [];
  const entries: AllocationEntry[] = [];

  if (!(payment.amount > EPSILON)) {
    return { paymentId: payment.id, entries, warnings: [{ code: "non_positive_amount" }] };
  }

  const periods = [...input.periods].sort(comparePeriods);
  // A payment that names its month fills that month and those after it before older ones.
  const start = input.startAt;
  const fillOrder = start
    ? [
        ...periods.filter((p) => comparePeriods(p, start) >= 0),
        ...periods.filter((p) => comparePeriods(p, start) < 0),
      ]
    : periods;
  if (periods.length === 0) {
    return { paymentId: payment.id, entries, warnings: [{ code: "no_period_context" }] };
  }

  const horizonMonths = input.horizonMonths ?? 12;
  const futureDueAmount = input.futureDueAmount ?? periods[periods.length - 1].dueAmount;

  let remaining = payment.amount;
  let first = true;

  // Pass 1 — fill known periods, oldest unfilled first (from `startAt` when the payment names one).
  for (const period of fillOrder) {
    if (remaining <= EPSILON) break;
    const open = period.dueAmount - period.allocatedAmount;
    if (open <= EPSILON) continue;

    const take = Math.min(remaining, open);
    entries.push({
      period: { year: period.year, month: period.month, id: period.id },
      amount: round2(take),
      // The first period touched carries the payment's intent: "rent" when it
      // settles that month in full, "partial" when the money ran out first.
      // Everything past the first period is carried-forward credit.
      type: first ? (take >= open - EPSILON ? "rent" : "partial") : "overpayment_credit",
    });
    remaining -= take;
    first = false;
  }

  // Pass 2 — absorb overpayment into engine-created future periods.
  if (remaining > EPSILON && futureDueAmount > EPSILON) {
    let nextIndex = periodIndex(periods[periods.length - 1]) + 1;
    const horizonEnd = nextIndex + horizonMonths;
    while (remaining > EPSILON && nextIndex < horizonEnd) {
      const take = Math.min(remaining, futureDueAmount);
      entries.push({
        period: { ...refFromIndex(nextIndex), created: true },
        amount: round2(take),
        type: first
          ? take >= futureDueAmount - EPSILON
            ? "rent"
            : "partial"
          : "overpayment_credit",
      });
      remaining -= take;
      first = false;
      nextIndex += 1;
    }
  }

  if (remaining > EPSILON) {
    warnings.push({ code: "horizon_exceeded", unallocated: round2(remaining) });
  }

  return { paymentId: payment.id, entries, warnings };
}

/**
 * Derive a rent period's persisted status. `fullyPaidAt` is the date of the
 * allocation that completed the period (null while not fully allocated).
 */
export function derivePeriodStatus(
  period: { dueDate: Date; dueAmount: number; allocatedAmount: number; fullyPaidAt?: Date | null },
  today: Date,
): RentPeriodStatus {
  const open = period.dueAmount - period.allocatedAmount;
  if (open <= EPSILON) {
    return period.fullyPaidAt && period.fullyPaidAt.getTime() > period.dueDate.getTime()
      ? "paid_late"
      : "paid";
  }
  if (today.getTime() < period.dueDate.getTime()) return "upcoming";
  if (period.allocatedAmount > EPSILON) return "partially_paid";
  // Due on the due date itself; overdue once a full day has passed.
  const msLate = today.getTime() - period.dueDate.getTime();
  return msLate > 24 * 60 * 60 * 1000 ? "overdue" : "due";
}

/**
 * Derive the tenant-level payment status from their periods' statuses —
 * replaces the manually-set Tenant.paymentStatus.
 */
export function deriveTenantStatus(statuses: RentPeriodStatus[]): TenantPaymentStatus {
  if (statuses.some((s) => s === "overdue" || s === "partially_paid")) return "overdue";
  if (statuses.some((s) => s === "due")) return "pending";
  return "paid";
}
