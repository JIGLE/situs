/**
 * Shared `?detail=<type>:<id>` query param convention for the unified entity
 * detail overlay (property/tenant/owner/lease). Pure string helpers
 * so every click site preserves whatever other search params the current
 * page already has (e.g. `/people?view=owners`) instead of clobbering them.
 */

export function withEntityDetail(
  pathname: string,
  currentSearch: string,
  type: string,
  id: string,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("detail", `${type}:${id}`);
  return `${pathname}?${params.toString()}`;
}

export function withoutEntityDetail(pathname: string, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch);
  params.delete("detail");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Parses `?detail=type:id` into its parts, or null if absent/malformed. */
export function parseEntityDetail(value: string | null): { type: string; id: string } | null {
  if (!value) return null;
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;
  return {
    type: value.slice(0, separatorIndex),
    id: value.slice(separatorIndex + 1),
  };
}
