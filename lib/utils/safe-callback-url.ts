/**
 * Only a same-site relative path may be a sign-in's destination, which rules out an open redirect
 * through `callbackUrl`. A protocol-relative `//host` and a backslash form (`/\host`, which browsers
 * read as `//host`) are not same-site, so both are refused along with anything absolute.
 */
export function safeCallbackUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
