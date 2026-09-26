/**
 * Internationalization (i18n) configuration
 * Moved from root i18n.ts for better organization
 */

import { notFound as _notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import enMessages from "@/messages/en.json";
import ptMessages from "@/messages/pt.json";
import esMessages from "@/messages/es.json";
import itMessages from "@/messages/it.json";

import { locales, defaultLocale, localeNames, type Locale } from "./locales";

export { locales, defaultLocale, localeNames, type Locale };

// Coming soon languages (for display in selector)
export const upcomingLocales = ["fr", "de", "nl", "pl", "ru", "zh", "ja"] as const;
export const upcomingLocaleNames: Record<string, string> = {
  fr: "Français",
  de: "Deutsch",
  nl: "Nederlands",
  pl: "Polski",
  ru: "Русский",
  zh: "中文",
  ja: "日本語",
};

// Message bundles - typed for next-intl compatibility
const messages = {
  pt: ptMessages,
  en: enMessages,
  es: esMessages,
  it: itMessages,
} as const;

// Next-intl configuration
export default getRequestConfig(async ({ requestLocale }) => {
  // Get the requested locale from the URL
  const requested = await requestLocale;

  // Validate and fallback to default if needed
  const locale = hasLocale(locales, requested ?? "") ? requested! : defaultLocale;

  return {
    locale,
    messages: messages[locale as keyof typeof messages],
  };
});
