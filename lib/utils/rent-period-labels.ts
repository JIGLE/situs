import type { RentPeriodStatus } from "@/lib/services/allocation/types";

/**
 * Each rent period status's key under `rentPeriodStatus`. `waived` is stored but missing from the
 * `RentPeriodStatus` union, so it is added here; the `Record` makes a status added to the union
 * without a label a compile error.
 */
const RENT_PERIOD_STATUS_KEY = {
  upcoming: "upcoming",
  due: "due",
  overdue: "overdue",
  partially_paid: "partially_paid",
  paid: "paid",
  paid_late: "paid_late",
  waived: "waived",
} as const satisfies Record<RentPeriodStatus | "waived", string>;

/** The key for a status as the API sends it (a string), or undefined for one it does not know. */
export function rentPeriodStatusKey(status: string | null | undefined) {
  return status && Object.hasOwn(RENT_PERIOD_STATUS_KEY, status)
    ? RENT_PERIOD_STATUS_KEY[status as keyof typeof RENT_PERIOD_STATUS_KEY]
    : undefined;
}
