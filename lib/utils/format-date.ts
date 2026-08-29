/**
 * Date display that follows the app's locale, not the browser's.
 *
 * `toLocaleDateString()` with no argument uses the browser's locale, which is not the language
 * the user chose in the app. A Portuguese instance opened in a browser set to English rendered
 * "8/14/2026" beside copy that said "Carregado", and the two disagreed on a screen that looked
 * entirely translated. Twenty-two call sites did this, four of them through near-identical
 * private `formatDate` helpers — one per feature folder, each re-deriving the same three lines
 * and each wrong the same way.
 *
 * `locale` is required rather than defaulting, because a default is how the argument goes
 * missing again. Components read it from `useLocale()`.
 */
export function formatDate(
  value: string | Date | null | undefined,
  locale: string,
  fallback = "—",
): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? fallback : date.toLocaleDateString(locale);
}

/** As `formatDate`, with the time — for audit and log lines where the hour matters. */
export function formatDateTime(
  value: string | Date | null | undefined,
  locale: string,
  fallback = "—",
): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? fallback : date.toLocaleString(locale);
}
