import { cookies } from "next/headers";

import { defaultLocale, locales, type Locale } from "@/lib/i18n/config";

/**
 * Resolve the viewer's locale for routes that carry no `[locale]` URL segment.
 *
 * Most of the app lives under `app/[locale]/`, so next-intl reads the locale straight off the
 * path. Two surfaces sit outside it and have no segment to read: the root redirect (`/`) and
 * the auth pages (`/auth/signin`, `/auth/signup`). Both fall back to the `situs-locale`
 * cookie, which the app's locale control writes (`language-selector.tsx`).
 *
 * Server-only — it reads `next/headers`, so it must not be imported from a client component.
 */
export async function getPreferredLocale(): Promise<Locale> {
  const saved = (await cookies()).get("situs-locale")?.value;
  return saved && (locales as readonly string[]).includes(saved)
    ? (saved as Locale)
    : defaultLocale;
}
