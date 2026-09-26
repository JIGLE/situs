/**
 * The languages the app speaks, and nothing else.
 *
 * Kept apart from `config.ts`, which calls next-intl's `getRequestConfig` when it loads: client code
 * that only needs the list (the locale cookie, the language switch, the account menu) would
 * otherwise pull the server's request config, and the four message catalogues, in with it.
 */
export const locales = ["pt", "en", "es", "it"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt";

/** Endonyms: each language named in itself, the same in every catalogue. */
export const localeNames: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
  it: "Italiano",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
