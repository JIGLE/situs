import { MODE_COOKIE, MODE_COOKIE_MAX_AGE_SECONDS, normalizeMode, type ThemeMode } from "./mode";

/**
 * Browser-only: reads and writes `document.cookie`.
 *
 * The choice lives in `localStorage` too, but only a cookie reaches the server, and a page the
 * server draws in the right theme needs neither an inline script nor a flash. The first visit
 * after a device chose a theme is the only one the script has to cover.
 */
export function readModeCookie(): ThemeMode | null {
  const prefix = `${MODE_COOKIE}=`;
  const found = document.cookie.split(";").find((part) => part.trim().startsWith(prefix));
  return normalizeMode(found?.trim().slice(prefix.length));
}

/** Keep `mode` on this device for the server to read. Answers whether the browser kept it. */
export function writeModeCookie(mode: ThemeMode): boolean {
  if (readModeCookie() === mode) return true;
  document.cookie = `${MODE_COOKIE}=${mode}; Path=/; Max-Age=${MODE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  return readModeCookie() === mode;
}
