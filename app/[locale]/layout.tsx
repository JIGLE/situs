import { ClientProviders } from "@/components/shared/client-providers";
import DevDebug from "@/components/shared/dev-debug";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { locales, defaultLocale } from "@/lib/i18n/config";
import { HtmlLangSync } from "@/components/shared/html-lang-sync";

// Generate static params for all supported locales
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale: requestedLocale } = await params;

  // Validate locale and fallback to default
  const locale = hasLocale(locales, requestedLocale) ? requestedLocale : defaultLocale;

  // Enable static rendering for this locale
  setRequestLocale(locale);

  // Pass `locale` explicitly. `setRequestLocale` alone was not enough here: the app has no
  // next-intl middleware, and the pages under `(main)` are `force-dynamic`, so `getMessages()`
  // resolved through `getRequestConfig`'s `requestLocale` fallback and shipped `defaultLocale`
  // (Portuguese) to the client provider for every locale — /en/leases served PT strings.
  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HtmlLangSync locale={locale} />
      <ClientProviders>
        {children}
        {process.env.NODE_ENV === "development" && <DevDebug />}
      </ClientProviders>
    </NextIntlClientProvider>
  );
}
