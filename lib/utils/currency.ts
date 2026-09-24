/**
 * Money formatting. Every amount in Situs is in euros: it serves Portuguese property only, so there
 * is no currency to choose, store or convert.
 */

export const EURO_SYMBOL = "€";

// pt-PT digits after a leading euro sign ("€1234,56", "€14 100,00"), as the app has always shown
// its default currency.
const EURO_DIGITS = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** An amount as euros, or "-" when there is none. */
export function formatEuro(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  return `${EURO_SYMBOL}${EURO_DIGITS.format(amount)}`;
}
