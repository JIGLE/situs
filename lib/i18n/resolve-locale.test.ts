import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveLocale } from "./resolve-locale";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  accept: null as string | null,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "situs-locale" && mocks.cookie ? { value: mocks.cookie } : undefined,
  }),
  headers: async () => ({
    get: (name: string) => (name === "accept-language" ? mocks.accept : null),
  }),
}));

describe("the language a visitor gets when the address says none", () => {
  it.each([
    ["a saved choice wins over the browser", "es", "en-US,en;q=0.9", "es"],
    ["the browser decides without a saved choice", undefined, "en-US,en;q=0.9", "en"],
    ["the first supported language the browser lists", undefined, "fr-FR,it;q=0.8,en;q=0.6", "it"],
    ["a region is read as its language", undefined, "pt-BR", "pt"],
    ["the default when the browser asks for nothing we speak", undefined, "fr-FR,de;q=0.8", "pt"],
    ["the default with no header at all", undefined, null, "pt"],
    ["the default for an empty header", undefined, "", "pt"],
    ["a saved value that is not a language is ignored", "klingon", "en", "en"],
    ["a saved value that is empty is ignored", "", "it", "it"],
  ])("%s", (_name, saved, header, expected) => {
    expect(resolveLocale(saved, header)).toBe(expected);
  });
});

describe("server-locale and the proxy agree", () => {
  it("the pages outside [locale] follow the browser when no choice was saved", async () => {
    const { getPreferredLocale } = await import("./server-locale");
    mocks.cookie = undefined;
    mocks.accept = "en-US,en;q=0.9";
    expect(await getPreferredLocale()).toBe("en");

    mocks.cookie = "it";
    expect(await getPreferredLocale()).toBe("it");

    mocks.cookie = undefined;
    mocks.accept = null;
    expect(await getPreferredLocale()).toBe("pt");
  });

  it("both go through the one resolver: neither keeps a copy of the rule", () => {
    const root = join(import.meta.dirname, "..", "..");
    for (const file of ["proxy.ts", "lib/i18n/server-locale.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, `${file} resolves the locale through resolve-locale.ts`).toMatch(
        /from "(?:\.\/lib|@\/lib)\/i18n\/resolve-locale"/,
      );
      expect(source, `${file} must not read Accept-Language itself`).not.toMatch(/split\(","\)/);
    }
  });
});
