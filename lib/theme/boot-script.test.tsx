// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { ThemeProvider } from "@/lib/contexts/theme-context";

import { DARK_THEME_COLOR, LIGHT_THEME_COLOR, THEME_BOOT_SCRIPT } from "./boot-script";

// tests/setup.ts replaces the theme context with a stub for every other test; this file is about
// the real provider.
vi.unmock("@/lib/contexts/theme-context");

/**
 * The page used to start light and switch once the app had loaded, so a dark-mode user saw a light
 * flash on every launch. The boot script applies the theme before the first paint, and the
 * provider applies it again once mounted; the two have to agree or the page flashes the other way.
 * Each case runs the real script string and the real provider against the same stored choice.
 */
function setPhone(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? dark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

function resetDocument() {
  const root = document.documentElement;
  root.removeAttribute("data-mode");
  root.removeAttribute("data-theme");
  root.removeAttribute("style");
  root.className = "";
  document.head.innerHTML = `
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">`;
}

const runScript = () => new Function(THEME_BOOT_SCRIPT)();
const mode = () => document.documentElement.getAttribute("data-mode");
const themeColors = () =>
  Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((tag) => ({
    content: tag.getAttribute("content"),
    media: tag.getAttribute("media"),
  }));

describe("theme boot script", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocument();
    setPhone(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is dark on a device with no choice, even when the phone is in light mode", () => {
    runScript();

    expect(mode()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it.each([
    ["normal", "normal"],
    ["light", "normal"],
    ["dark", "dark"],
    ["dark-oled", "dark"],
    ["something-new", "dark"],
  ])("takes the stored choice %s as %s", (stored, expected) => {
    localStorage.setItem("situs-mode", stored);
    runScript();

    expect(mode()).toBe(expected);
  });

  it("follows the phone only when the device chose `system`", () => {
    localStorage.setItem("situs-mode", "system");
    setPhone(false);
    runScript();
    expect(mode()).toBe("normal");

    resetDocument();
    setPhone(true);
    runScript();
    expect(mode()).toBe("dark");
  });

  it("reads the pre-rebrand key too, as the provider does", () => {
    localStorage.setItem("proman-theme", "light");
    runScript();

    expect(mode()).toBe("normal");
  });

  it("colours the status bar to match, and drops the per-scheme split", () => {
    runScript();
    expect(themeColors()).toEqual([
      { content: DARK_THEME_COLOR, media: null },
      { content: DARK_THEME_COLOR, media: null },
    ]);

    resetDocument();
    localStorage.setItem("situs-mode", "normal");
    runScript();
    expect(themeColors().every((tag) => tag.content === LIGHT_THEME_COLOR)).toBe(true);
  });

  it("writes the status-bar tag itself when the document has none", () => {
    document.head.innerHTML = "";
    runScript();

    expect(themeColors()).toEqual([{ content: DARK_THEME_COLOR, media: null }]);
  });

  it("never throws, even when storage is unreadable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(runScript).not.toThrow();
    expect(mode()).toBe("dark");
  });
});

describe("the provider agrees with the boot script", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocument();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [null, false],
    [null, true],
    ["normal", true],
    ["light", true],
    ["dark", false],
    ["dark-oled", false],
    ["system", false],
    ["system", true],
    ["something-new", false],
  ])("for a stored choice of %s on a phone in dark=%s", async (stored, phoneDark) => {
    setPhone(phoneDark);
    if (stored) localStorage.setItem("situs-mode", stored);

    resetDocument();
    runScript();
    const bootMode = mode();

    resetDocument();
    render(
      <ThemeProvider>
        <span />
      </ThemeProvider>,
    );
    await waitFor(() => expect(mode()).not.toBeNull());

    expect(mode()).toBe(bootMode);
  });

  it("moves the status-bar colour when the theme is toggled", async () => {
    setPhone(false);
    localStorage.setItem("situs-mode", "normal");
    render(
      <ThemeProvider>
        <span />
      </ThemeProvider>,
    );
    await waitFor(() => expect(mode()).toBe("normal"));

    expect(themeColors().every((tag) => tag.content === LIGHT_THEME_COLOR)).toBe(true);
  });
});
