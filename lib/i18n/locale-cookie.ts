import { locales, type Locale } from "@/lib/i18n/config";

/**
 * The cookie the interface's language is read from.
 *
 * `proxy.ts` rewrites every path to `/{locale}/…` by it, and the pages outside the `[locale]`
 * segment (sign-in, the root redirect) resolve their locale from it (`server-locale.ts`). Both
 * read it by this name without importing it: the proxy cannot import client code, and a server
 * module has no `document`.
 *
 * Browser-only: these read and write `document.cookie`.
 */
export const LOCALE_COOKIE = "situs-locale";

const ONE_YEAR_SECONDS = 31536000;

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (locales as readonly string[]).includes(value);
}

/** The language chosen on this device, or null when none was: the proxy then goes by the browser. */
export function readLocaleCookie(): Locale | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  const value = match?.[1];
  return isLocale(value) ? value : null;
}

/**
 * Choose `locale` on this device. Answers whether the browser kept it: a browser refusing cookies
 * would otherwise have a caller refresh the page into the language it already shows, and a caller
 * that refreshes until the cookie matches would never stop.
 */
export function writeLocaleCookie(locale: Locale): boolean {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  return readLocaleCookie() === locale;
}
