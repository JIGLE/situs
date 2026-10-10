import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";

import { LegalLinks } from "./legal-links";

const catalogues = { en, pt, es, it: it_ } as const;

describe("LegalLinks", () => {
  it.each(["en", "pt", "es", "it"] as const)("names both pages in %s", (locale) => {
    render(<LegalLinks />, { initialLocale: locale });

    const legal = catalogues[locale].legal;
    expect(screen.getByRole("link", { name: legal.privacyTitle })).toBeDefined();
    expect(screen.getByRole("link", { name: legal.termsTitle })).toBeDefined();
    expect(screen.getByRole("navigation", { name: legal.linksLabel })).toBeDefined();
  });

  it("goes to the two pages, without a language prefix", () => {
    render(<LegalLinks />, { initialLocale: "pt" });

    expect(screen.getByRole("link", { name: pt.legal.privacyTitle }).getAttribute("href")).toBe(
      "/privacy",
    );
    expect(screen.getByRole("link", { name: pt.legal.termsTitle }).getAttribute("href")).toBe(
      "/terms",
    );
  });

  it("keeps a phone-sized tap target on each link", () => {
    render(<LegalLinks />, { initialLocale: "en" });

    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
    }
  });
});
