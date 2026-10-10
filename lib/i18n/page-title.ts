import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { locales, type Locale } from "@/lib/i18n/locales";
import { getPreferredLocale } from "@/lib/i18n/server-locale";

/**
 * The title of a page, in the viewer's language.
 *
 * Only the privacy and terms pages set one, so every other tab, history entry and bookmark read
 * "Situs — Sovereign Capital System" whatever it showed (WCAG 2.4.2). The root layout's
 * `%s · Situs` template adds the product name, so these return the page's own name, taken from
 * the labels the navigation already uses rather than a second set of strings.
 *
 * Pages under `[locale]` pass their `params`; the auth pages sit outside that segment and fall
 * back to the `situs-locale` cookie, like their layout (`app/auth/layout.tsx`).
 */
type Params = Promise<{ locale?: string }> | undefined;

export async function pageLocale(params?: Params): Promise<Locale> {
  const fromUrl = params ? (await params).locale : undefined;
  return hasLocale(locales, fromUrl) ? fromUrl : getPreferredLocale();
}

export type NavigationPage =
  "dashboard" | "portfolio" | "leases" | "finance" | "people" | "settings" | "complete" | "admin";

export async function navigationTitle(page: NavigationPage, params?: Params): Promise<Metadata> {
  const t = await getTranslations({ locale: await pageLocale(params), namespace: "navigation" });
  return { title: t(page) };
}

export async function adminTitle(page: "status" | "access", params?: Params): Promise<Metadata> {
  const locale = await pageLocale(params);
  if (page === "status") {
    const t = await getTranslations({ locale, namespace: "admin" });
    return { title: t("title") };
  }
  const t = await getTranslations({ locale, namespace: "admin.shell.nav" });
  return { title: t("access") };
}

export async function authTitle(page: "signin" | "signup" | "mfa" | "error"): Promise<Metadata> {
  const locale = await pageLocale();
  switch (page) {
    case "signin": {
      const t = await getTranslations({ locale, namespace: "auth" });
      return { title: t("signIn") };
    }
    case "signup": {
      const t = await getTranslations({ locale, namespace: "auth" });
      return { title: t("createAccount") };
    }
    case "mfa": {
      const t = await getTranslations({ locale, namespace: "auth.mfa" });
      return { title: t("heading") };
    }
    case "error": {
      const t = await getTranslations({ locale, namespace: "authError" });
      return { title: t("title") };
    }
  }
}
