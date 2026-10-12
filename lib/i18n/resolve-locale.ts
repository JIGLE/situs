import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/locales";

/**
 * The language a visitor gets when the address says none: their saved choice, else what their browser
 * asks for, else the default.
 *
 * One function for both places that decide it. `proxy.ts` rewrites every page to `/{locale}/…` by it,
 * and `lib/i18n/server-locale.ts` gives the same answer to the pages outside the `[locale]` segment and
 * to the root layout that draws `<html lang>`. They used to disagree: the proxy read the browser's
 * `Accept-Language`, the server module only the cookie. A visitor with an English browser and no saved
 * choice therefore got an English app, a Portuguese sign-in page, and a privacy notice whose text was
 * Portuguese under `lang="en"` and an EN language control.
 *
 * Pure, so the proxy can import it (it cannot import `next/headers`).
 */
export function resolveLocale(
  saved: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(saved)) return saved;

  const asked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";")[0].trim().slice(0, 2).toLowerCase())
    .find((tag): tag is Locale => isLocale(tag));

  return asked ?? defaultLocale;
}
