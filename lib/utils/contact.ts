/**
 * Contact fields shown together, such as "ana@example.com · 912 345 678": only the ones there are,
 * and nothing at all, rather than a lone separator, when there are none.
 */
export function joinContact(...fields: (string | null | undefined)[]): string {
  return fields
    .map((field) => field?.trim())
    .filter(Boolean)
    .join(" · ");
}
