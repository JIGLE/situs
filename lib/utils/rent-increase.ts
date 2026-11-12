/**
 * The rules of a yearly rent update in Portugal (NRAU art. 24, Código Civil art. 1077), as pure
 * functions the Leases screen and the API share.
 *
 * - The first update can apply one year after the contract started, and each later one a year
 *   after the previous update: the year runs from the contract, never from 1 January.
 * - The tenant is told in writing at least 30 days before the first rent at the new amount is due.
 * - The percentage is the coefficient INE publishes each autumn for the next calendar year.
 *
 * A contract can set its own update clause, which wins over these defaults, so the screen warns
 * rather than refuses.
 */

/** The annual rent update coefficients published in Diário da República, as a percentage. */
export const RENT_UPDATE_COEFFICIENTS: Readonly<Record<number, number>> = {
  2024: 6.94,
  2025: 2.16,
  2026: 2.24,
};

/** The days of written notice a rent update needs before the first rent at the new amount. */
export const NOTICE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The coefficient for the calendar year an update takes effect, when it is known. */
export function coefficientFor(year: number): number | null {
  return RENT_UPDATE_COEFFICIENTS[year] ?? null;
}

/** The first day of the month a date falls in, UTC. */
export function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** `date` moved by whole months, on the first of the month, UTC. */
export function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

/** A month as `YYYY-MM`, the value of an `<input type="month">`. */
export function toMonthValue(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` as the first day of that month, UTC, or null when it is not one. */
export function fromMonthValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(Number(match[1]), month - 1, 1));
}

/** Rent after a percentage increase, to the cent. */
export function increasedRent(rent: number, percent: number): number {
  return Math.round(rent * (1 + percent / 100) * 100) / 100;
}

export interface IncreaseBasis {
  /** The lease's start date. */
  startDate: Date;
  /** The month the last update took effect, when there was one. */
  lastIncreaseFrom?: Date | null;
}

/** The first month an update may take effect: a year after the start or the last update. */
export function anniversaryMonth({ startDate, lastIncreaseFrom }: IncreaseBasis): Date {
  return addMonths(monthStartUtc(lastIncreaseFrom ?? startDate), 12);
}

/** Whole days from the notice to the first day of the month the new rent starts. */
export function noticeDaysBefore(noticeDate: Date, effectiveFrom: Date): number {
  const notice = Date.UTC(
    noticeDate.getUTCFullYear(),
    noticeDate.getUTCMonth(),
    noticeDate.getUTCDate(),
  );
  return Math.floor((effectiveFrom.getTime() - notice) / DAY_MS);
}

/**
 * The month to suggest: the earliest that is both a year after the start (or the last update) and
 * at least 30 days after a notice sent on `noticeDate`.
 */
export function suggestedStartMonth(basis: IncreaseBasis, noticeDate: Date): Date {
  let month = anniversaryMonth(basis);
  while (noticeDaysBefore(noticeDate, month) < NOTICE_DAYS) month = addMonths(month, 1);
  return month;
}

export type RentIncreaseWarning = "before_anniversary" | "short_notice";

/** What a planned update does not meet. Empty when it follows the default rules. */
export function rentIncreaseWarnings(
  basis: IncreaseBasis,
  noticeDate: Date,
  effectiveFrom: Date,
): RentIncreaseWarning[] {
  const warnings: RentIncreaseWarning[] = [];
  if (effectiveFrom.getTime() < anniversaryMonth(basis).getTime()) {
    warnings.push("before_anniversary");
  }
  if (noticeDaysBefore(noticeDate, effectiveFrom) < NOTICE_DAYS) warnings.push("short_notice");
  return warnings;
}

export interface PendingIncrease {
  effectiveFrom: Date;
  newRent: number;
}

/**
 * The rent owed for the month starting `month`: the latest pending increase that has started by
 * then, or the lease's current rent.
 */
export function rentForMonth(
  currentRent: number,
  pending: readonly PendingIncrease[],
  month: Date,
): number {
  let rent = currentRent;
  let from = -Infinity;
  for (const increase of pending) {
    const at = increase.effectiveFrom.getTime();
    if (at <= month.getTime() && at > from) {
      rent = increase.newRent;
      from = at;
    }
  }
  return rent;
}
