import { describe, it, expect, vi, beforeEach } from "vitest";

import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";

const catalogues = { en, pt, es, it: it_ } as const;

const { preferred } = vi.hoisted(() => ({ preferred: { current: "en" as string } }));
vi.mock("@/lib/i18n/server-locale", () => ({ getPreferredLocale: async () => preferred.current }));

// A plain lookup over the real catalogues, by locale and dotted namespace.
vi.mock("next-intl/server", () => ({
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: keyof typeof catalogues;
    namespace: string;
  }) => {
    const node = namespace
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], catalogues[locale]);
    return (key: string) => (node as Record<string, string>)[key] ?? `MISSING:${namespace}.${key}`;
  },
}));

import { adminTitle, authTitle, navigationTitle, pageLocale } from "./page-title";

const params = (locale: string) => Promise.resolve({ locale });

beforeEach(() => {
  preferred.current = "en";
});

describe("pageLocale", () => {
  it("takes the locale from the URL when it is one the app ships", async () => {
    await expect(pageLocale(params("pt"))).resolves.toBe("pt");
  });

  it("falls back to the cookie's locale for a segment it does not ship, or none", async () => {
    preferred.current = "es";
    await expect(pageLocale(params("xx"))).resolves.toBe("es");
    await expect(pageLocale()).resolves.toBe("es");
  });
});

describe("titles", () => {
  it.each(["en", "pt", "es", "it"] as const)("names the dashboard in %s", async (locale) => {
    await expect(navigationTitle("dashboard", params(locale))).resolves.toEqual({
      title: catalogues[locale].navigation.dashboard,
    });
  });

  it("is the label the navigation shows, not a second string", async () => {
    await expect(navigationTitle("finance", params("pt"))).resolves.toEqual({
      title: pt.navigation.finance,
    });
    await expect(navigationTitle("complete", params("it"))).resolves.toEqual({
      title: it_.navigation.complete,
    });
  });

  it("names the admin pages from the admin catalogue", async () => {
    await expect(adminTitle("status", params("en"))).resolves.toEqual({ title: en.admin.title });
    await expect(adminTitle("access", params("pt"))).resolves.toEqual({
      title: pt.admin.shell.nav.access,
    });
  });

  it("names the auth pages in the cookie's language, since they have no locale segment", async () => {
    preferred.current = "pt";
    await expect(authTitle("signin")).resolves.toEqual({ title: pt.auth.signIn });
    await expect(authTitle("signup")).resolves.toEqual({ title: pt.auth.createAccount });
    await expect(authTitle("mfa")).resolves.toEqual({ title: pt.auth.mfa.heading });
    await expect(authTitle("error")).resolves.toEqual({ title: pt.authError.title });
  });

  it("never returns a title that is a missing key", async () => {
    for (const locale of ["en", "pt", "es", "it"]) {
      const { title } = await navigationTitle("admin", params(locale));
      expect(String(title)).not.toMatch(/^MISSING/);
      expect(String(title).length).toBeGreaterThan(0);
    }
  });
});
