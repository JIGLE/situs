"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

import { DARK_THEME_COLOR, LIGHT_THEME_COLOR } from "@/lib/theme/boot-script";
import { normalizeMode, type ThemeMode } from "@/lib/theme/mode";
import { readModeCookie, writeModeCookie } from "@/lib/theme/mode-cookie";
import {
  DEFAULT_COUNTRY,
  DEFAULT_PALETTE,
  isCountryCode,
  isPaletteKey,
  resolveThemeVars,
  type CountryCode,
  type PaletteKey,
} from "@/lib/design/country-themes";

/**
 * Situs country theme provider.
 *
 * Three independent axes:
 *  - country  → the logo's flag colours, and nothing else (design study K3)
 *  - palette  → the interface's colours: Azulejo, Oliveira (the default) or Grafite
 *  - mode     → "normal" | "dark" (or "system" to follow the OS)
 *
 * The country palette drives the Situs Portal logo authentically; the UI
 * accent is contrast-adjusted inside resolveThemeVars. Semantic status
 * colours never change with country or mode.
 */

type ResolvedMode = "normal" | "dark";

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: ResolvedMode;
  country: CountryCode;
  palette: PaletteKey;
  setTheme: (mode: ThemeMode) => void;
  setCountry: (country: CountryCode) => void;
  setPalette: (palette: PaletteKey) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const MODE_STORAGE_KEY = "situs-mode";
const COUNTRY_STORAGE_KEY = "situs-country";
const PALETTE_STORAGE_KEY = "situs-palette";
/**
 * Pre-rebrand key — read once for migration, then superseded.
 *
 * Deliberately NOT renamed with the rest of the proman→situs sweep. This constant does not name
 * the product; it names the key already sitting in existing browsers' localStorage. Renaming it
 * would point the migration at a key that has never existed, silently turning it into dead code
 * and dropping the theme preference of everyone it was written to rescue.
 */
const LEGACY_THEME_STORAGE_KEY = "proman-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  // Dark until this device says otherwise: the document starts dark (`app/layout.tsx`) and the
  // boot script has already applied a stored choice by the time this mounts.
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedMode>("dark");
  const [country, setCountryState] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [palette, setPaletteState] = useState<PaletteKey>(DEFAULT_PALETTE);
  // Read by applyTheme, so a country or mode change keeps the palette without a dependency on it.
  const paletteRef = React.useRef<PaletteKey>(DEFAULT_PALETTE);
  const [_mounted, setMounted] = useState(false);

  const getSystemMode = useCallback((): ResolvedMode => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "normal";
    }
    return "normal";
  }, []);

  const resolveMode = useCallback(
    (preference: ThemeMode): ResolvedMode =>
      preference === "system" ? getSystemMode() : preference,
    [getSystemMode],
  );

  // Apply country + mode to the document: data attributes for the static CSS,
  // inline vars (precomputed, contrast-checked) for non-default countries.
  const applyTheme = useCallback((nextCountry: CountryCode, resolved: ResolvedMode) => {
    const root = document.documentElement;

    root.setAttribute("data-country", nextCountry);
    root.setAttribute("data-mode", resolved);
    // Legacy hooks kept during the migration window: pre-Situs CSS/tests key
    // off .light/.dark classes and data-theme.
    root.classList.remove("light", "dark", "dark-oled");
    root.classList.add(resolved === "dark" ? "dark" : "light");
    root.setAttribute("data-theme", resolved === "dark" ? "dark" : "light");
    root.style.colorScheme = resolved === "dark" ? "dark" : "light";
    // The status bar of an installed app follows this tag, so it moves with the theme.
    document.querySelectorAll('meta[name="theme-color"]').forEach((tag) => {
      tag.setAttribute("content", resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
      tag.removeAttribute("media");
    });

    root.setAttribute("data-palette", paletteRef.current);
    const vars = resolveThemeVars(nextCountry, resolved, paletteRef.current);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }

    setResolvedTheme(resolved);
  }, []);

  // Initialize: local choice wins (instant, flash-free). Fresh browsers start dark,
  // then adopt the account's saved theme once /api/settings responds.
  useEffect(() => {
    const storedCountryRaw = localStorage.getItem(COUNTRY_STORAGE_KEY);
    const storedCountry =
      storedCountryRaw && isCountryCode(storedCountryRaw) ? storedCountryRaw : DEFAULT_COUNTRY;
    setCountryState(storedCountry);
    const storedPaletteRaw = localStorage.getItem(PALETTE_STORAGE_KEY);
    const storedPalette =
      storedPaletteRaw && isPaletteKey(storedPaletteRaw) ? storedPaletteRaw : DEFAULT_PALETTE;
    paletteRef.current = storedPalette;
    setPaletteState(storedPalette);

    // This device's storage first, then the cookie the server renders from (a device whose storage
    // was cleared but not its cookies still knows its choice).
    const storedMode =
      normalizeMode(localStorage.getItem(MODE_STORAGE_KEY)) ??
      normalizeMode(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) ??
      readModeCookie();

    if (storedMode) {
      setThemeState(storedMode);
      applyTheme(storedCountry, resolveMode(storedMode));
      // A choice made before the cookie existed reaches the server from the next request on.
      writeModeCookie(storedMode);
      setMounted(true);
      return;
    }

    // No choice on this device: dark. (It used to follow the phone, which left a phone in light
    // mode opening a dark-first brand in light.) An account that saved an explicit theme still
    // wins below; the column's default, "system", is not a choice.
    setThemeState("dark");
    applyTheme(storedCountry, resolveMode("dark"));
    setMounted(true);

    let cancelled = false;
    fetch("/api/settings", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const serverMode = normalizeMode(body?.data?.theme as string | undefined);
        if (
          cancelled ||
          !serverMode ||
          serverMode === "system" ||
          localStorage.getItem(MODE_STORAGE_KEY)
        ) {
          return;
        }
        setThemeState(serverMode);
        localStorage.setItem(MODE_STORAGE_KEY, serverMode);
        writeModeCookie(serverMode);
        applyTheme(storedCountry, resolveMode(serverMode));
      })
      .catch(() => {
        /* not signed in / offline — keep the system default */
      });
    return () => {
      cancelled = true;
    };
  }, [applyTheme, resolveMode]);

  // Follow OS changes while in system mode.
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyTheme(country, getSystemMode());
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, country, applyTheme, getSystemMode]);

  const setTheme = useCallback(
    (newMode: ThemeMode) => {
      setThemeState(newMode);
      localStorage.setItem(MODE_STORAGE_KEY, newMode);
      writeModeCookie(newMode);
      applyTheme(country, resolveMode(newMode));
    },
    [country, applyTheme, resolveMode],
  );

  const setCountry = useCallback(
    (newCountry: CountryCode) => {
      if (!isCountryCode(newCountry)) return;
      setCountryState(newCountry);
      localStorage.setItem(COUNTRY_STORAGE_KEY, newCountry);
      applyTheme(newCountry, resolveMode(theme));
    },
    [theme, applyTheme, resolveMode],
  );

  const setPalette = useCallback(
    (next: PaletteKey) => {
      if (!isPaletteKey(next)) return;
      paletteRef.current = next;
      setPaletteState(next);
      localStorage.setItem(PALETTE_STORAGE_KEY, next);
      applyTheme(country, resolveMode(theme));
    },
    [country, theme, applyTheme, resolveMode],
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "normal" ? "dark" : "normal");
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        country,
        palette,
        setTheme,
        setCountry,
        setPalette,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
