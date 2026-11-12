/**
 * Situs country theme system.
 *
 * Two independent color systems, per the Situs brand spec:
 *  1. LOGO ROLES — authentic flag colours mapped by visual role (arc / line / dot).
 *     Never contrast-adjusted: white stays white, yellow stays vivid. Visibility is
 *     handled by the logo canvas + keyline, not by tinting the flag colours.
 *  2. UI THEMES — a country-matched "normal" and "dark" palette, readability-first.
 *     The UI accent may be adjusted for contrast; semantic status colours
 *     (success/warning/danger/info) are country-independent and never change.
 *
 * Ported 1:1 from the approved Situs mockup (Mockup.html) so the rendered app and
 * the design source of truth cannot drift.
 */

export type ThemeMode = "normal" | "dark";

export interface LogoRoles {
  /** Arc — dominant field colour or defining structural flag colour. */
  primary: string;
  /** Foundation line. */
  secondary: string;
  /** Central dot. */
  accent: string;
  neutral: string;
  /** Human-readable mapping rationale, shown on the (dev-only) Brand page. */
  note: string;
}

export interface ThemeTokens {
  ink: string;
  bone: string;
  canvas: string;
  surface: string;
  surfaceSolid: string;
  border: string;
  accent: string;
  muted: string;
  hover: string;
}

export interface CountryTheme {
  name: string;
  roles: LogoRoles;
  normal: ThemeTokens;
  dark: ThemeTokens;
}

// --- Color math (WCAG relative luminance / contrast) -----------------------

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return { r: 0, g: 0, b: 0 };
  const bigint = parseInt(clean, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const v = Math.max(0, Math.min(255, Math.round(x)));
        return v.toString(16).padStart(2, "0");
      })
      .join("")
      .toUpperCase()
  );
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  const channel = [rgb.r, rgb.g, rgb.b].map((v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  });
  return channel[0] * 0.2126 + channel[1] * 0.7152 + channel[2] * 0.0722;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function mixWith(hex: string, targetHex: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(targetHex);
  return rgbToHex(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
  );
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.35;
}

/**
 * Adjust a country colour until it reads at >= 4.5:1 against the given canvas.
 * The logo keeps the raw colour; only UI highlights use this readable variant.
 */
export function readableHighlight(raw: string, canvasBg: string): string {
  if (contrastRatio(raw, canvasBg) >= 4.5) return raw;

  const toward = isDark(canvasBg) ? "#FFFFFF" : "#000000";
  for (let i = 0.12; i <= 0.88; i += 0.08) {
    const candidate = mixWith(raw, toward, i);
    if (contrastRatio(candidate, canvasBg) >= 4.5) return candidate;
  }

  return contrastRatio("#000000", canvasBg) > contrastRatio("#FFFFFF", canvasBg)
    ? "#000000"
    : "#FFFFFF";
}

// --- Theme construction (ported from the mockup's makeTheme) ---------------

function makeTheme(
  ink: string,
  canvas: string,
  surfaceSolid: string,
  border: string,
  accent: string,
  muted: string,
): ThemeTokens {
  const dark = isDark(canvas);
  return {
    ink,
    bone: dark ? "#0D1117" : "#FBFBFB",
    canvas,
    // Light panels are the solid surface: a white card on a quiet canvas. As a 2.5% black wash
    // every nested box came out a shade darker than its parent, so a screen was beige on beige on
    // beige and nothing read as the page.
    surface: dark ? "rgba(255,255,255,0.035)" : surfaceSolid,
    surfaceSolid,
    border,
    accent,
    muted,
    hover: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.055)",
  };
}

// --- Country table (1:1 with Mockup.html countryThemes) --------------------

export const COUNTRY_THEMES: Record<string, CountryTheme> = {
  EU: {
    name: "European Union",
    roles: {
      primary: "#003399",
      secondary: "#003399",
      accent: "#FFCC00",
      neutral: "#FFFFFF",
      note: "European Union: arc blue, line blue, dot yellow.",
    },
    normal: makeTheme("#0F172A", "#F5F7FB", "#FFFFFF", "#DFE5EE", "#003399", "#64748B"),
    dark: makeTheme("#F8FAFC", "#0B1020", "#111936", "#273A66", "#FFCC00", "#BAC7DA"),
  },
  PT: {
    name: "Portugal",
    roles: {
      primary: "#006600",
      secondary: "#FF0000",
      accent: "#FFFF00",
      neutral: "#FFFFFF",
      note: "Portugal: arc green, line red, dot yellow.",
    },
    normal: makeTheme("#221D16", "#F7F6F3", "#FFFFFF", "#E4E0D8", "#006600", "#6A6357"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FFFF00", "#A5B8A9"),
  },
};

export type CountryCode = keyof typeof COUNTRY_THEMES;

// --- Interface palettes (design study K3 and P, chosen 12 Nov 2026) ---------
//
// The country now colours the logo only. The interface takes one of these palettes, which the
// owner picks in Settings › Account; each was chosen so its accent can fill a primary button in
// both modes. A country's own `normal`/`dark` tokens above are kept as the record of the old
// per-country interface, and are no longer applied.

export const UI_PALETTES = {
  azulejo: {
    normal: makeTheme("#1C1E24", "#F6F6F3", "#FFFFFF", "#E2E1DC", "#1D4E89", "#62646B"),
    dark: makeTheme("#EDF1F7", "#0D1117", "#151B24", "#28323F", "#8DB4E8", "#A1AAB6"),
  },
  oliveira: {
    normal: makeTheme("#23231C", "#F5F4EF", "#FFFFFF", "#E3E1D8", "#4E6B3A", "#696858"),
    dark: makeTheme("#EFF2EA", "#0F110C", "#181B14", "#2C3126", "#A9C48E", "#A6AD9C"),
  },
  grafite: {
    normal: makeTheme("#1D1F22", "#F6F6F4", "#FFFFFF", "#E2E2DF", "#1F4E5F", "#62676D"),
    dark: makeTheme("#ECEEF0", "#0F1113", "#171A1D", "#2A2F34", "#7CC4D6", "#9AA3AB"),
  },
} as const satisfies Record<string, { normal: ThemeTokens; dark: ThemeTokens }>;

export type PaletteKey = keyof typeof UI_PALETTES;
export const PALETTE_KEYS = Object.keys(UI_PALETTES) as PaletteKey[];
export const DEFAULT_PALETTE: PaletteKey = "oliveira";

export function isPaletteKey(value: string): value is PaletteKey {
  return Object.prototype.hasOwnProperty.call(UI_PALETTES, value);
}

/** The text on a button filled with the accent: white where it reads, else the dark canvas. */
export function onAccent(accent: string, darkText: string): string {
  return contrastRatio(accent, "#FFFFFF") >= 4.5 ? "#FFFFFF" : darkText;
}

export const COUNTRY_CODES = Object.keys(COUNTRY_THEMES) as CountryCode[];

export const DEFAULT_COUNTRY: CountryCode = "PT";
export const DEFAULT_MODE: ThemeMode = "normal";

// Semantic status colours — identical in every country theme, both modes.
export const SEMANTIC_TOKENS = {
  "--semantic-success": "#166534",
  "--semantic-success-soft": "rgba(22,101,52,.08)",
  "--semantic-warning": "#B45309",
  "--semantic-warning-soft": "rgba(180,83,9,.08)",
  "--semantic-danger": "#B91C1C",
  "--semantic-danger-soft": "rgba(185,28,28,.08)",
  "--semantic-info": "#1D4ED8",
  "--semantic-info-soft": "rgba(29,78,216,.08)",
} as const;

/**
 * Resolve the full CSS custom-property map for a country + mode.
 * Everything the runtime needs is precomputed here (including the
 * contrast-adjusted UI highlight) so applying a theme is a plain var swap.
 */
export function resolveThemeVars(
  country: CountryCode,
  mode: ThemeMode,
  palette: PaletteKey = DEFAULT_PALETTE,
): Record<string, string> {
  const entry = COUNTRY_THEMES[country] ?? COUNTRY_THEMES[DEFAULT_COUNTRY];
  const pair = UI_PALETTES[palette] ?? UI_PALETTES[DEFAULT_PALETTE];
  const theme: ThemeTokens = mode === "dark" ? pair.dark : pair.normal;
  // The highlight is text and borders on the sidebar's active row, a green wash over the canvas.
  const highlightBackdrop = isDark(theme.canvas)
    ? mixWith(theme.canvas, "#FFFFFF", 0.1)
    : theme.canvas;
  // The interface's accent is the palette's; the flag colours stay in the logo (K3).
  const highlight = readableHighlight(theme.accent, highlightBackdrop);
  const darkText = isDark(theme.canvas) ? theme.canvas : theme.ink;
  const accentText = onAccent(theme.accent, darkText);
  const textBackdrop = isDark(theme.canvas) ? mixWith(theme.canvas, "#FFFFFF", 0.05) : theme.canvas;
  const mutedSurface = isDark(theme.canvas)
    ? theme.surfaceSolid
    : mixWith(theme.surfaceSolid, theme.ink, 0.06);
  const logoKeyline = isDark(theme.surfaceSolid) ? "rgba(255,255,255,0.68)" : "rgba(0,0,0,0.48)";

  // On a light theme the canvas is the backdrop; on a dark one text is light, so the lightest
  // background is the one that costs it the most contrast.
  const readableOnChip = (token: keyof typeof SEMANTIC_TOKENS & `--semantic-${string}`) => {
    if (!isDark(theme.canvas)) return readableHighlight(SEMANTIC_TOKENS[token], textBackdrop);
    const chipOnPanel = mixWith(theme.surfaceSolid, SEMANTIC_TOKENS[token], 0.08);
    const backdrop =
      contrastRatio(chipOnPanel, "#000000") > contrastRatio(textBackdrop, "#000000")
        ? chipOnPanel
        : textBackdrop;
    return readableHighlight(SEMANTIC_TOKENS[token], backdrop);
  };

  return {
    "--color-ink": theme.ink,
    "--color-bone": theme.bone,
    "--color-canvas": theme.canvas,
    "--color-surface": theme.surface,
    "--color-surface-solid": theme.surfaceSolid,
    // `theme.muted` is a mid-tone TEXT colour (PT dark is #A5B8A9), but `--color-muted` is a
    // SURFACE token — all 34 of its uses in the app are `bg-`/`backgroundColor`, none is text.
    // Writing the text colour into it painted every muted surface a mid-tone sage: badges,
    // progress tracks, skeletons, the command palette, and most visibly the `/admin` shell,
    // whose page background is this token. It also put `--color-muted-foreground` (the same
    // #A5B8A9, from globals.css) directly on top of itself, i.e. 1:1 contrast — invisible text.
    //
    // The surface belongs to `surfaceSolid`, which is what globals.css already defines
    // `--color-muted` as for the default country, and the text colour belongs to the
    // foreground token, which nothing was setting per country at all.
    // On a light theme the panel is white, so a muted surface (a skeleton, a count badge, a
    // progress track) is a step darker than it or it would not show at all.
    "--color-muted": mutedSurface,
    // Corrected against the muted SURFACE rather than the canvas: it is the tighter of the two
    // backgrounds this text lands on, and the table's raw values sit at 4.15–4.44:1 on the light
    // themes — below AA, and below the 4.89:1 the hand-tuned globals.css value already reached.
    "--color-muted-foreground": readableHighlight(theme.muted, mutedSurface),
    "--color-border": theme.border,
    // Panels and their rows draw a lighter line than form fields (design study D1).
    "--color-hairline": mixWith(
      theme.border,
      theme.surfaceSolid,
      isDark(theme.canvas) ? 0.3 : 0.45,
    ),
    "--color-hover": theme.hover,
    "--ui-accent": theme.accent,
    // Every token that carried the country's green in globals.css now carries the palette's
    // accent: focus rings, the active menu row, selected borders, and the primary button, which
    // the accent fills (design study D4).
    "--color-ring": highlight,
    "--color-focus": highlight,
    "--color-ui-accent": theme.accent,
    "--color-country": highlight,
    "--color-sidebar-text-active": highlight,
    "--color-inner-border-active": highlight,
    "--color-secondary-foreground": highlight,
    // The surfaces and text globals.css writes for first paint, which a palette now replaces too:
    // otherwise a dark Azulejo panel sat on Oliveira's green-black page.
    "--color-background": theme.canvas,
    "--color-foreground": theme.ink,
    "--color-card-foreground": theme.ink,
    "--color-card-solid": theme.surfaceSolid,
    "--color-popover": theme.surfaceSolid,
    "--color-popover-foreground": theme.ink,
    "--color-primary": theme.ink,
    "--color-accent-foreground": theme.ink,
    "--color-input": theme.border,
    "--color-inner-border": theme.border,
    "--color-surface-raised": theme.surfaceSolid,
    "--color-surface-elevated": theme.surfaceSolid,
    "--color-surface-3": theme.surfaceSolid,
    "--color-surface-overlay": isDark(theme.canvas) ? theme.canvas : theme.surfaceSolid,
    "--color-sidebar-bg": isDark(theme.canvas) ? "rgba(255,255,255,0.035)" : theme.surfaceSolid,
    "--color-sidebar-foreground": theme.ink,
    "--color-sidebar-border": theme.border,
    "--color-sidebar-text": readableHighlight(theme.muted, theme.surfaceSolid),
    "--color-accent-primary": theme.accent,
    "--color-accent-primary-foreground": accentText,
    "--color-accent-secondary": theme.accent,
    "--color-accent-secondary-foreground": accentText,
    "--country-highlight-readable": highlight,
    "--country-highlight-soft": hexToRgba(highlight, 0.08),
    "--logo-primary": entry.roles.primary,
    "--logo-secondary": entry.roles.secondary,
    "--logo-accent": entry.roles.accent,
    // The raw accent is a flag colour and stays untinted wherever the LOGO renders. The hero's
    // orbit rings are UI, not the mark, so they take a contrast-adjusted variant instead —
    // Portugal's accent is pure #FFFF00, which is invisible on the light theme's cream canvas.
    "--logo-accent-readable": readableHighlight(entry.roles.accent, theme.canvas),
    "--logo-neutral": entry.roles.neutral,
    "--logo-canvas": theme.surfaceSolid,
    "--logo-keyline": logoKeyline,
    ...SEMANTIC_TOKENS,
    // Text-safe semantic variants: raw semantic hues are kept for borders and
    // soft washes, but as body/badge TEXT they miss 4.5:1 on dark canvases, so
    // the same contrast algorithm that fixes the country highlight fixes these.
    // They are measured on the lightest background the text lands on: the card, a 3.5% white wash
    // (`--color-card`), which a hue that clears the canvas by a hair (4.47:1) fails on; and a
    // status chip on a `Panel`, its own 8% wash over the solid surface, which is lighter still.
    "--semantic-success-readable": readableOnChip("--semantic-success"),
    "--semantic-warning-readable": readableOnChip("--semantic-warning"),
    "--semantic-danger-readable": readableOnChip("--semantic-danger"),
    "--semantic-info-readable": readableOnChip("--semantic-info"),
  };
}

export function isCountryCode(value: string): value is CountryCode {
  return Object.prototype.hasOwnProperty.call(COUNTRY_THEMES, value);
}

/**
 * The country's name in the reader's language.
 *
 * `COUNTRY_THEMES[code].name` is an English string, so anything rendering it would say
 * "Portugal" in the one spelling. Translating the table would mean each name times four
 * catalogues, maintained by hand.
 *
 * `Intl.DisplayNames` already knows them, in every locale the app has and every one it might add,
 * with nothing to maintain. It even covers the table's one non-ISO entry — EU comes back as
 * "União Europeia".
 *
 * The table's `name` stays as the fallback for a code the platform does not recognise.
 *
 * Lives here, beside the table it falls back to. The portfolio tree uses it to name the country
 * of a cluster.
 */
export function countryLabel(code: string, locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: "region" }).of(code);
    if (display && display !== code) return display;
  } catch {
    // Unsupported locale or a code that is not a region — fall through to the table.
  }
  return isCountryCode(code) ? COUNTRY_THEMES[code].name : code;
}
