/**
 * Who owned a property, and in what shares, on a given day.
 *
 * A `PropertyOwner` row is one owner's share over a stretch of time: from `validFrom` (NULL means
 * from the beginning) up to, not including, `validTo` (NULL means still in force). A change of
 * shares closes the rows it replaces and opens new ones on the day it takes effect, so the shares
 * that held in March stay readable after a sale in June, and a receipt for March still names
 * March's landlords.
 *
 * Changes are appended to the end of a property's timeline, never inserted before its last change:
 * that keeps the shares in force on any day a single set, which the 100% check can add up.
 */

import type { Prisma } from "@prisma/client";

/** Midnight UTC of the day a date falls on: shares change between days, not within one. */
export function dayOf(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The rows in force on `day`: started on or before it, and not closed on or before it. */
export function inForceOn(day: Date): Prisma.PropertyOwnerWhereInput {
  return {
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: day } }] },
      { OR: [{ validTo: null }, { validTo: { gt: day } }] },
    ],
  };
}

/** The rows in force now and from here on: the ones no change has closed. */
export const CURRENT_SHARES: Prisma.PropertyOwnerWhereInput = { validTo: null };

export interface ShareSpan {
  validFrom: Date | null;
  validTo: Date | null;
}

/** Whether a row was in force on `day`, by the same rule as `inForceOn`. */
export function isInForceOn(share: ShareSpan, day: Date): boolean {
  return (
    (share.validFrom === null || share.validFrom <= day) &&
    (share.validTo === null || share.validTo > day)
  );
}

/**
 * The last day a property's shares changed: no new change may take effect before it. Null when
 * every row runs from the beginning and none has been closed.
 */
export function lastChangeOf(shares: ShareSpan[]): Date | null {
  let last: Date | null = null;
  for (const share of shares) {
    for (const day of [share.validFrom, share.validTo]) {
      if (day && (!last || day > last)) last = day;
    }
  }
  return last;
}
