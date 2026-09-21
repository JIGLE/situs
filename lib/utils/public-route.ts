function isLocaleSegment(segment: string): boolean {
  const parts = segment.split("-");
  if (parts.length === 1) {
    return parts[0].length === 2 && /^[a-zA-Z]+$/.test(parts[0]);
  }

  if (parts.length === 2) {
    return (
      parts[0].length === 2 &&
      parts[1].length === 2 &&
      /^[a-zA-Z]+$/.test(parts[0]) &&
      /^[a-zA-Z]+$/.test(parts[1])
    );
  }

  return false;
}

/**
 * Returns true when a pathname points to a public page where authenticated
 * dashboard data should not be eagerly fetched.
 */
export function isPublicPagePath(pathname: string | null | undefined): boolean {
  if (!pathname) return true;

  const segments = pathname.split("/").filter(Boolean);
  const appSegments =
    segments.length > 0 && isLocaleSegment(segments[0]) ? segments.slice(1) : segments;

  // Locale root or site root (/, /pt, /en)
  if (appSegments.length === 0) return true;

  const first = appSegments[0]?.toLowerCase();

  // Public flows
  if (first === "auth") return true;

  return false;
}
