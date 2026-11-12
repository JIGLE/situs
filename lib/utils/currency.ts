/**
 * Money formatting. Every amount in Situs is in euros: it serves Portuguese property only, so there
 * is no currency to choose, store or convert.
 */

export const EURO_SYMBOL = "€";

/** The no-break space between an amount and its sign. */
export const EURO_GAP = "\u00A0";

/** Digits already formatted, with the euro sign after them. */
export function withEuroSign(digits: string): string {
  return `${digits}${EURO_GAP}${EURO_SYMBOL}`;
}

// pt-PT digits with the euro sign after them, as Portugal writes an amount ("1234,56 €",
// "14 100,00 €"). The space is a no-break space, so a narrow column never strands the sign on a
// line of its own.
const EURO_DIGITS = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An amount as euros, or "-" when there is none. */
export function formatEuro(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  return withEuroSign(EURO_DIGITS.format(amount));
}
