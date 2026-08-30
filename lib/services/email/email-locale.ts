/**
 * Which language an outbound email is written in.
 *
 * Extracted from `lib/services/notifications/reminder-email.ts`, which held the catalogue map
 * and `resolveLocale` privately and correctly. A second consumer arrived — the tenant portal
 * invitation — and copying three lines into it is exactly the arrangement this codebase keeps
 * paying for: two tables that agree today and drift later. `format-date.ts`,
 * `receipt-labels.ts` and `maintenance-labels.ts` were all the same move.
 *
 * The catalogues are imported statically rather than read at runtime because these run in cron
 * jobs and service code where there is no request, no `NextIntlClientProvider`, and nothing to
 * negotiate a locale against. `lib/utils/format-message.ts` does the interpolation.
 */

import enMessages from "@/messages/en.json";
import ptMessages from "@/messages/pt.json";
import esMessages from "@/messages/es.json";
import itMessages from "@/messages/it.json";

export const MESSAGES = {
  en: enMessages,
  pt: ptMessages,
  es: esMessages,
  it: itMessages,
} as const;

export type SupportedLocale = keyof typeof MESSAGES;

/** A stored language string, or `"en"` when it is absent or not one of the four catalogues. */
export function resolveLocale(language: string | null | undefined): SupportedLocale {
  return language && language in MESSAGES ? (language as SupportedLocale) : "en";
}

/**
 * The language of the country a property is in.
 *
 * Only the two countries this product serves. Deliberately not a general country→language table:
 * inventing one would imply the app can write to a tenant in a language it has no catalogue for,
 * and the fallback below is `en` for exactly that reason.
 */
const COUNTRY_LOCALE: Record<string, SupportedLocale> = {
  PT: "pt",
  ES: "es",
};

/**
 * The language to write to a tenant in.
 *
 * `tenant.locale` first — someone set it deliberately, and it is the only signal that can say
 * "this tenant reads English even though the flat is in Lisbon". Then the property's country,
 * which is how `CorrespondenceTemplate` already picks a jurisdiction. Then English.
 *
 * A null `locale` is the normal state for every row that predates the column, so the country
 * step is the one that does the work in practice, not a last resort.
 */
export function resolveTenantLocale(tenant: {
  locale?: string | null;
  property?: { propertyCountry?: string | null } | null;
}): SupportedLocale {
  if (tenant.locale && tenant.locale in MESSAGES) {
    return tenant.locale as SupportedLocale;
  }
  const country = tenant.property?.propertyCountry?.toUpperCase();
  return (country && COUNTRY_LOCALE[country]) || "en";
}
