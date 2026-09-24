import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

/**
 * The checks a contract's reading must pass before it is written: on the review sheet, so the
 * owner sees each one before Confirm, and again in the import's schema, which is the one that
 * counts. Pure, so both sides run the same rules.
 */

/**
 * How far from 100% the shares may land, in hundredths of a percent. Thirds written as 33.33 total
 * 99.99, and that is a whole property; 99.9 is not. Counted in whole hundredths, because in
 * floating point 3 × 33.33 misses 100 by a hair more than 0.01.
 */
export const SHARE_TOLERANCE_HUNDREDTHS = 1;

export function sharesTotal(landlords: ReadonlyArray<{ share?: number | null }>): number {
  return landlords.reduce((sum, landlord) => sum + (landlord.share ?? 0), 0);
}

export function sharesTotalHundred(landlords: ReadonlyArray<{ share?: number | null }>): boolean {
  return Math.abs(Math.round(sharesTotal(landlords) * 100) - 10_000) <= SHARE_TOLERANCE_HUNDREDTHS;
}

/** Both ISO dates (YYYY-MM-DD), the end after the start. Such strings compare as dates. */
export function datesInOrder(start: string | null | undefined, end: string | null | undefined) {
  return !!start && !!end && start < end;
}

/**
 * A tax number the import would refuse: a Portuguese NIF whose check digit fails. A number from
 * another country is not checked, and no number at all is allowed.
 */
export function nifInvalid(taxId: string | null | undefined, country: string | null | undefined) {
  return !!taxId?.trim() && (country || "PT") === "PT" && !validatePortugueseNIF(taxId);
}
