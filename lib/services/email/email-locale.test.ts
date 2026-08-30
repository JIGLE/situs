import { describe, it, expect } from "vitest";
import { resolveLocale, resolveTenantLocale } from "./email-locale";
import { t } from "@/lib/utils/format-message";
import ptMessages from "@/messages/pt.json";
import esMessages from "@/messages/es.json";
import enMessages from "@/messages/en.json";

/**
 * Which language an email goes out in, and that the invitation actually has words in it.
 *
 * The portal invitation was English for every tenant, including one who reached it through the
 * portal's own resend form — a form inside a fully translated portal. `Tenant.locale` did not
 * exist, so there was nothing to resolve against; these pin the order that replaced it.
 *
 * Asserting Portuguese rather than English, for the reason the rest of this repo does: the
 * defect was English, so an English assertion cannot distinguish a fix from the bug.
 */
describe("resolveTenantLocale", () => {
  it("prefers the tenant's own language", () => {
    // The whole reason the column exists: an expat reading English in a Lisbon flat.
    expect(resolveTenantLocale({ locale: "en", property: { propertyCountry: "PT" } })).toBe("en");
  });

  it("falls back to the property's country when the tenant has none", () => {
    // Null is the normal state for every row that predates the column, so this branch is the
    // one that does the work in practice.
    expect(resolveTenantLocale({ locale: null, property: { propertyCountry: "PT" } })).toBe("pt");
    expect(resolveTenantLocale({ locale: null, property: { propertyCountry: "ES" } })).toBe("es");
  });

  it("is case-insensitive about the country code", () => {
    expect(resolveTenantLocale({ locale: null, property: { propertyCountry: "pt" } })).toBe("pt");
  });

  it("falls back to English when neither is known", () => {
    expect(resolveTenantLocale({ locale: null, property: null })).toBe("en");
    expect(resolveTenantLocale({ locale: null, property: { propertyCountry: "FR" } })).toBe("en");
  });

  it("ignores a locale the app has no catalogue for", () => {
    // A stored "de" must not select a catalogue that does not exist; the country still answers.
    expect(resolveTenantLocale({ locale: "de", property: { propertyCountry: "ES" } })).toBe("es");
  });
});

describe("resolveLocale", () => {
  it("passes through a supported language and defaults the rest to English", () => {
    expect(resolveLocale("pt")).toBe("pt");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale("de")).toBe("en");
  });
});

describe("the portal invitation has real copy in every catalogue", () => {
  const KEYS = [
    "subject",
    "heading",
    "greeting",
    "intro",
    "propertyLabel",
    "listIntro",
    "itemInvoices",
    "itemHistory",
    "itemMaintenance",
    "cta",
    "expiry",
    "closing",
  ] as const;

  it("resolves every key, in each language, to something other than the key itself", () => {
    // `getMessage` returns the path when a key is missing, so a typo shows up as
    // "notifications.email.portalInvite.cta" landing in a tenant's inbox rather than as a throw.
    for (const [name, messages] of [
      ["pt", ptMessages],
      ["es", esMessages],
      ["en", enMessages],
    ] as const) {
      for (const key of KEYS) {
        const path = `notifications.email.portalInvite.${key}`;
        const value = t(messages as Record<string, unknown>, path, { tenant: "Ana", manager: "M" });
        expect(value, `${name}.${key}`).not.toBe(path);
        expect(value.length, `${name}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolates the tenant and manager names", () => {
    const greeting = t(
      ptMessages as Record<string, unknown>,
      "notifications.email.portalInvite.greeting",
      {
        tenant: "Ana Silva",
      },
    );
    expect(greeting).toContain("Ana Silva");
    expect(greeting).not.toContain("{tenant}");
  });

  it("is Portuguese in the Portuguese catalogue", () => {
    // Not merely present — actually translated. A copy-paste of the English would pass the
    // key-resolution test above and fail this one.
    expect(
      t(ptMessages as Record<string, unknown>, "notifications.email.portalInvite.subject"),
    ).not.toBe(
      t(enMessages as Record<string, unknown>, "notifications.email.portalInvite.subject"),
    );
  });
});
