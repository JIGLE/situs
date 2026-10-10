import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
// Development-only server patch to help locate React.Children.only failures
import "@/lib/dev/patch-react-children-only";
import "./globals.css";
import { getNonce } from "@/lib/utils/csp-nonce";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/boot-script";
import UpdateBannerClient from "@/components/shared/update-banner-client";
import { PwaRegister } from "@/components/shared/pwa-register";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { getPreferredLocale } from "@/lib/i18n/server-locale";
import { DevAuthProvider } from "@/components/shared/dev-auth";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500", "600"],
});

const BRAND_TAGLINE = "Situs — Sovereign Capital System";
const BRAND_DESCRIPTION =
  "Situs puts property income, receipts and tax evidence under control — bank movement matching, reference-month allocation, receipt automation and document intelligence for EU property portfolios.";

export const metadata: Metadata = {
  title: {
    default: BRAND_TAGLINE,
    template: "%s · Situs",
  },
  applicationName: "Situs",
  description: BRAND_DESCRIPTION,
  openGraph: {
    title: BRAND_TAGLINE,
    description: BRAND_DESCRIPTION,
    type: "website",
    locale: "en_US",
    siteName: "Situs",
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_TAGLINE,
    description: BRAND_DESCRIPTION,
  },
  // Installable PWA / iOS home-screen support.
  appleWebApp: {
    capable: true,
    title: "Situs",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Let content extend under the notch / home indicator so the mobile top bar
  // and bottom nav can pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  // No `themeColor` here on purpose: the boot script writes the one `theme-color` tag
  // (`lib/theme/boot-script.ts` says why neither Next nor a rendered tag can).
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  // Get CSP nonce for inline scripts/styles
  const nonce = await getNonce();

  // Locale for the app chrome that renders outside the `[locale]` segment. It also drives
  // `<html lang>` below, which used to be hardcoded to `defaultLocale` — so every response
  // claimed Portuguese whatever it actually rendered. That was survivable while the URL still
  // named the language; unprefixed, this attribute is the only thing in the response that does,
  // and screen readers and translation tooling read it.
  const chromeLocale = await getPreferredLocale();
  setRequestLocale(chromeLocale);
  const chromeMessages = await getMessages({ locale: chromeLocale });

  return (
    <html
      lang={chromeLocale}
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} dark`}
      style={{ colorScheme: "dark" }}
      data-country="PT"
      data-mode="dark"
      data-theme="dark"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {nonce && <meta name="csp-nonce" content={nonce} />}
        {/* Applies this device's theme before anything is painted (`lib/theme/boot-script.ts`). */}
        <script
          nonce={nonce || undefined}
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className={`${instrumentSans.className} antialiased`}>
        <DevAuthProvider>
          {/* These two are siblings of `children`, so they sit outside the
              `NextIntlClientProvider` that `app/[locale]/layout.tsx` mounts — calling
              `useTranslations` inside them throws "context not found". Give them their own
              provider resolved from the `situs-locale` cookie, the same way
              `app/auth/layout.tsx` handles the routes that carry no `[locale]` segment. */}
          <NextIntlClientProvider locale={chromeLocale} messages={chromeMessages}>
            {/* Update banner (admin-only) */}
            <UpdateBannerClient />
          </NextIntlClientProvider>
          {children}
          <NextIntlClientProvider locale={chromeLocale} messages={chromeMessages}>
            <PwaRegister />
          </NextIntlClientProvider>
        </DevAuthProvider>
      </body>
    </html>
  );
}
