/**
 * When a recurring expense repeats. Pure, so the list (which says when the next copy is due) and
 * the service that makes the copies (`lib/services/expenses/recurring.ts`) count the same dates.
 *
 * The expense the owner typed is the first occurrence. Each later one falls `step` months after
 * it, on `recurrenceDay` (clamped to the month's length), and none falls after `recurrenceEnd`.
 * Dates are calendar days in UTC, as the form stores them ("2026-11-01" → midnight UTC).
 */

export const RECURRENCE_STEP_MONTHS = { monthly: 1, quarterly: 3, annual: 12 } as const;

export interface RecurrenceTemplate {
  date: Date | string;
  recurrenceRule?: string | null;
  recurrenceDay?: number | null;
  recurrenceEnd?: Date | string | null;
}

/** A guard, not a rule: forty years of monthly copies. */
const MAX_OCCURRENCES = 480;

function stepOf(rule: string | null | undefined): number {
  return RECURRENCE_STEP_MONTHS[(rule ?? "monthly") as keyof typeof RECURRENCE_STEP_MONTHS] ?? 1;
}

/** The k-th occurrence after the first (k ≥ 1). */
function occurrence(template: RecurrenceTemplate, k: number): Date {
  const first = new Date(template.date);
  const monthIndex = first.getUTCMonth() + k * stepOf(template.recurrenceRule);
  const year = first.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(template.recurrenceDay ?? first.getUTCDate(), daysInMonth);
  return new Date(Date.UTC(year, month, day));
}

function endOf(template: RecurrenceTemplate): number {
  return template.recurrenceEnd ? new Date(template.recurrenceEnd).getTime() : Infinity;
}

/**
 * The occurrences after `after` (exclusive) and up to `until` (inclusive), oldest first. `after`
 * defaults to the expense's own date: that occurrence is the expense itself.
 */
export function occurrencesBetween(
  template: RecurrenceTemplate,
  until: Date,
  after?: Date | string | null,
): Date[] {
  const from = new Date(after ?? template.date).getTime();
  const to = Math.min(until.getTime(), endOf(template));
  const dates: Date[] = [];
  for (let k = 1; k <= MAX_OCCURRENCES; k++) {
    const date = occurrence(template, k);
    if (date.getTime() > to) break;
    if (date.getTime() > from) dates.push(date);
  }
  return dates;
}

/** The first occurrence after `now`, or null once the expense has stopped repeating. */
export function nextOccurrence(template: RecurrenceTemplate, now: Date = new Date()): Date | null {
  for (let k = 1; k <= MAX_OCCURRENCES; k++) {
    const date = occurrence(template, k);
    if (date.getTime() > endOf(template)) return null;
    if (date.getTime() > now.getTime()) return date;
  }
  return null;
}
