import { EURO_SYMBOL, formatEuro } from "@/lib/utils/currency";

/**
 * The money formatter components call. It was a context that loaded the user's chosen currency
 * from their settings; with euros as the only currency there is nothing to load, so every caller
 * gets the same formatter and no provider is needed.
 */
const EURO = { formatCurrency: formatEuro, currencySymbol: EURO_SYMBOL } as const;

export function useCurrency(): typeof EURO {
  return EURO;
}
