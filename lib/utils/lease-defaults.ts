/**
 * What a new lease starts with, so the owner checks figures instead of typing them.
 *
 * - The term runs from the 1st of next month for one year (to the day before the anniversary).
 * - The rent is the property's asking rent, once a property is chosen and no rent has been typed.
 * - The deposit is one month's rent, and follows the rent for as long as nobody has changed it.
 * - The end date follows the start date for as long as nobody has changed it.
 *
 * Pure: every function takes the values it needs and returns the fields to change.
 */

type LeaseDraft = {
  startDate: string;
  endDate: string;
  monthlyRent: number;
  deposit: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar date as `YYYY-MM-DD`, from its parts, with no time zone in between. */
function isoDate(year: number, month: number, day: number): string {
  // Date.UTC normalises an overflowing month or day (month 13 is January of the next year).
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The last day of a one-year term that starts on `start` (`YYYY-MM-DD`), or "" if unreadable. */
export function oneYearTermEnd(start: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isoDate(year + 1, month, day - 1);
}

/** A new lease's term: the 1st of the month after `today`, for one year. */
export function defaultLeaseTerm(today: Date): { startDate: string; endDate: string } {
  const startDate = isoDate(today.getFullYear(), today.getMonth() + 2, 1);
  return { startDate, endDate: oneYearTermEnd(startDate) };
}

/** The fields to change when a property is chosen: its rent, when no rent has been typed yet. */
export function onPropertyChosen(
  draft: LeaseDraft,
  propertyRent: number | null | undefined,
): Partial<LeaseDraft> {
  if (draft.monthlyRent > 0 || !propertyRent || propertyRent <= 0) return {};
  return { monthlyRent: propertyRent, ...(draft.deposit === 0 ? { deposit: propertyRent } : {}) };
}

/** The fields to change when the rent is typed: the deposit too, while it still mirrors the rent. */
export function onRentChanged(draft: LeaseDraft, monthlyRent: number): Partial<LeaseDraft> {
  const depositUntouched = draft.deposit === 0 || draft.deposit === draft.monthlyRent;
  return { monthlyRent, ...(depositUntouched ? { deposit: monthlyRent } : {}) };
}

/** The fields to change when the start is typed: the end too, while it is still the default term. */
export function onStartChanged(draft: LeaseDraft, startDate: string): Partial<LeaseDraft> {
  const endUntouched = draft.endDate === "" || draft.endDate === oneYearTermEnd(draft.startDate);
  const endDate = oneYearTermEnd(startDate);
  return { startDate, ...(endUntouched && endDate ? { endDate } : {}) };
}
