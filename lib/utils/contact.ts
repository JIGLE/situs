/**
 * A contact field as it is stored: trimmed, and NULL when nothing is left.
 *
 * An email, a phone number or a room count the owner does not have is not an empty string. `""`
 * reads as a value to every check for one, and it collides on a unique index, where NULL does not
 * (a unique index admits any number of NULLs). A blank input arrives as `""`, so every write of
 * one of these goes through here.
 */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

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
