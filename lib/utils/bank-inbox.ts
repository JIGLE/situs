/**
 * The bank inbox's filters, and the counts behind them. Shared by the inbox, the Finance tab
 * badge, the dashboard and `GET /api/bank/transactions/summary`, so the number on the badge is
 * the number of rows the default filter shows.
 */

/** How many movements each filter holds. `toReview` is money in waiting for the owner. */
export interface BankInboxSummary {
  toReview: number;
  /** Money going out. Nothing about it can be confirmed as rent, so it is never work. */
  outgoing: number;
  autoMatched: number;
  confirmed: number;
  ignored: number;
  all: number;
}

/** In the order the inbox offers them. The first is the default: the owner's to-do list. */
export const INBOX_FILTERS = ["review", "outgoing", "auto", "confirmed", "ignored", "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** The query each filter sends to `GET /api/bank/transactions`. */
export const INBOX_FILTER_QUERY: Record<InboxFilter, string> = {
  review: "?status=needs_review&direction=in",
  outgoing: "?status=needs_review&direction=out",
  auto: "?status=auto_matched",
  confirmed: "?status=matched_confirmed",
  ignored: "?status=ignored",
  all: "",
};

/** Which count belongs to which filter. */
export const INBOX_FILTER_COUNT: Record<InboxFilter, keyof BankInboxSummary> = {
  review: "toReview",
  outgoing: "outgoing",
  auto: "autoMatched",
  confirmed: "confirmed",
  ignored: "ignored",
  all: "all",
};

export function isInboxFilter(value: string): value is InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(value);
}

const DIGITS = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A movement's amount in the app's money format: "€850,00", or "−€850,00" for money going out.
 * `currency` is kept per movement because an account's currency is the bank's to say, so any
 * other currency is shown by its code rather than dressed as euros.
 */
export function formatMovementAmount(amount: number, currency: string): string {
  const sign = amount < 0 ? "−" : "";
  const digits = DIGITS.format(Math.abs(amount));
  return currency === "EUR" ? `${sign}€${digits}` : `${sign}${digits} ${currency}`;
}

/** Whole days from `now` until `date`, rounded up; negative once it has passed. */
export function daysUntil(date: string | Date, now: Date = new Date()): number {
  const target = date instanceof Date ? date : new Date(date);
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/** Consent this close to its end is shown as a warning, with time to reconnect. */
export const CONSENT_WARNING_DAYS = 14;
