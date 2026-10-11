// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { ThemeProvider } from "@/lib/contexts/theme-context";
import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";

import { ThemeSwitcher } from "./theme-switcher";

// tests/setup.ts stands in for the theme context everywhere else; this file is about the real one.
vi.unmock("@/lib/contexts/theme-context");

const catalogues = { en, pt, es, it: it_ } as const;
const mode = () => document.documentElement.getAttribute("data-mode");
const cookieValue = () => document.cookie.match(/(?:^|;\s*)situs-mode=([^;]+)/)?.[1] ?? null;

function setPhone(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? dark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

function open(locale: "en" | "pt" | "es" | "it") {
  render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
    { initialLocale: locale },
  );
  const trigger = screen.getByRole("button", { name: catalogues[locale].common.changeTheme });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("ThemeSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "situs-mode=; Path=/; Max-Age=0";
    document.documentElement.removeAttribute("data-mode");
    setPhone(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["en", "pt", "es", "it"] as const)("offers the three choices in %s", async (locale) => {
    open(locale);

    const c = catalogues[locale];
    expect(await screen.findByRole("menuitem", { name: c.common.themeDark })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: c.common.themeLight })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: c.settings.panel.themeSystem })).toBeDefined();
  });

  it("moves a device that never chose from dark to light, and keeps it for the server", async () => {
    open("pt");

    fireEvent.click(await screen.findByRole("menuitem", { name: pt.common.themeLight }));

    await waitFor(() => expect(mode()).toBe("normal"));
    expect(localStorage.getItem("situs-mode")).toBe("normal");
    expect(cookieValue()).toBe("normal");
  });

  it("gets a device out of Light again", async () => {
    localStorage.setItem("situs-mode", "normal");
    open("en");
    await waitFor(() => expect(mode()).toBe("normal"));

    fireEvent.click(await screen.findByRole("menuitem", { name: en.common.themeDark }));

    await waitFor(() => expect(mode()).toBe("dark"));
    expect(cookieValue()).toBe("dark");
  });

  it("follows the phone on System, in either direction", async () => {
    setPhone(true);
    open("en");
    fireEvent.click(await screen.findByRole("menuitem", { name: en.settings.panel.themeSystem }));
    await waitFor(() => expect(cookieValue()).toBe("system"));
    expect(mode()).toBe("dark");
  });

  it("marks the current choice", async () => {
    localStorage.setItem("situs-mode", "system");
    open("en");

    const current = await screen.findByRole("menuitem", { name: en.settings.panel.themeSystem });
    expect(current.className).toContain("font-medium");
  });

  it("keeps a phone-sized tap target on the trigger", () => {
    const trigger = open("en");

    expect(trigger.className).toContain("max-md:min-h-11");
  });
});
