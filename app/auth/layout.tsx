import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

import { ThemeProvider } from "@/lib/contexts/theme-context";
import { getPreferredLocale } from "@/lib/i18n/server-locale";

import { AuthSessionProvider } from "./session-provider";

/**
 * The auth pages live at `/auth/*`, outside the `[locale]` segment, so next-intl has no URL
 * locale to read and these screens rendered untranslated English for every viewer. Resolve the
 * locale from the `situs-locale` cookie instead and mount the provider here, mirroring
 * `app/[locale]/layout.tsx`'s `setRequestLocale` → `getMessages()` sequence.
 *
 * The theme provider is mounted here for the same reason: it lives in `app/[locale]/layout.tsx`,
 * so these pages had no provider at all, and nothing on them could change the theme.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getPreferredLocale();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
