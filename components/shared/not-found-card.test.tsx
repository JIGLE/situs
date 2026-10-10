import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";

const catalogues = { en, pt, es, it: it_ } as const;

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale: keyof typeof catalogues; namespace: string }) => {
    const { locale, namespace } =
      typeof arg === "string" ? { locale: "en" as const, namespace: arg } : arg;
    const node = namespace
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], catalogues[locale]);
    return (key: string) => (node as Record<string, string>)[key] ?? `MISSING:${key}`;
  },
}));

import { NotFoundCard } from "./not-found-card";

describe("the page-not-found card", () => {
  it.each(["en", "pt", "es", "it"] as const)("says so in %s", async (locale) => {
    render(await NotFoundCard({ locale }));

    const copy = catalogues[locale].errors.notFound;
    expect(screen.getByText(copy.title)).toBeDefined();
    expect(screen.getByText(copy.description)).toBeDefined();
    expect(screen.getByRole("link", { name: copy.returnHome })).toBeDefined();
  });

  it("goes to the root, which the proxy sends on in the visitor's language, never to /en", async () => {
    render(await NotFoundCard({ locale: "pt" }));

    const link = screen.getByRole("link", { name: pt.errors.notFound.returnHome });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.getAttribute("href")).not.toMatch(/^\/en\b/);
  });

  it("reads the route's own locale when none is passed (the signed-in area)", async () => {
    render(await NotFoundCard({}));

    expect(screen.getByText(en.errors.notFound.title)).toBeDefined();
  });
});
