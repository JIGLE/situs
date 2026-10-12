import { cookies, headers } from "next/headers";

import type { Locale } from "@/lib/i18n/locales";
import { resolveLocale } from "@/lib/i18n/resolve-locale";

/**
 * Resolve the viewer's locale for routes that carry no `[locale]` URL segment.
 *
 * Most of the app lives under `app/[locale]/`, so next-intl reads the locale straight off the
 * path. Two surfaces sit outside it and have no segment to read: the root redirect (`/`) and
 * the auth pages (`/auth/signin`, `/auth/signup`). Both go by the `situs-locale` cookie, which the
 * app's locale control writes (`language-selector.tsx`), then by the browser's `Accept-Language`, as
 * the proxy does for every other page (`resolve-locale.ts`).
 *
 * Server-only — it reads `next/headers`, so it must not be imported from a client component.
 */
export async function getPreferredLocale(): Promise<Locale> {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get("situs-locale")?.value, requestHeaders.get("accept-language"));
}
