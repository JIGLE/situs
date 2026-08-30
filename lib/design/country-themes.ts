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
    surface: dark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.025)",
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
    normal: makeTheme("#0F172A", "#F5F7FB", "#EEF3FA", "#D8E0EC", "#003399", "#64748B"),
    dark: makeTheme("#F8FAFC", "#0B1020", "#111936", "#273A66", "#FFCC00", "#BAC7DA"),
  },
  AT: {
    name: "Austria",
    roles: {
      primary: "#EF3340",
      secondary: "#EF3340",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Austria: arc red, line red, dot white.",
    },
    normal: makeTheme("#201819", "#FAF7F7", "#F2ECEC", "#E3D7D8", "#EF3340", "#766A6B"),
    dark: makeTheme("#F6F1F2", "#120D0E", "#1D1416", "#342528", "#FFFFFF", "#BCAEB0"),
  },
  BE: {
    name: "Belgium",
    roles: {
      primary: "#000000",
      secondary: "#ED2939",
      accent: "#FAE042",
      neutral: "#FFFFFF",
      note: "Belgium: arc black, line red, dot yellow.",
    },
    normal: makeTheme("#111111", "#FAF9F2", "#F0EEDC", "#DCD6B9", "#000000", "#6B6654"),
    dark: makeTheme("#F5F3E8", "#11100A", "#1D1A10", "#342F1D", "#FAE042", "#C6BFA3"),
  },
  BG: {
    name: "Bulgaria",
    roles: {
      primary: "#00966E",
      secondary: "#D62612",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Bulgaria: arc green, line red, dot white.",
    },
    normal: makeTheme("#18251F", "#F7FAF7", "#EFF4EF", "#DCE6DC", "#00966E", "#68766B"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FFFFFF", "#A5B8A9"),
  },
  HR: {
    name: "Croatia",
    roles: {
      primary: "#171796",
      secondary: "#FF0000",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Croatia: arc blue, line red, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#171796", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  CY: {
    name: "Cyprus",
    roles: {
      primary: "#D57800",
      secondary: "#4E5B31",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Cyprus: arc copper, line olive, dot white.",
    },
    normal: makeTheme("#221D16", "#F6F0E4", "#F1E8D8", "#DDD3C3", "#D57800", "#756E63"),
    dark: makeTheme("#F8F0E6", "#130E08", "#21170D", "#3A2B1B", "#D57800", "#BDAE9A"),
  },
  CZ: {
    name: "Czechia",
    roles: {
      primary: "#11457E",
      secondary: "#D7141A",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Czechia: arc blue, line red, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#11457E", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  DK: {
    name: "Denmark",
    roles: {
      primary: "#C8102E",
      secondary: "#C8102E",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Denmark: arc red, line red, dot white.",
    },
    normal: makeTheme("#201819", "#FAF7F7", "#F2ECEC", "#E3D7D8", "#C8102E", "#766A6B"),
    dark: makeTheme("#F6F1F2", "#120D0E", "#1D1416", "#342528", "#FFFFFF", "#BCAEB0"),
  },
  EE: {
    name: "Estonia",
    roles: {
      primary: "#0072CE",
      secondary: "#000000",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Estonia: arc blue, line black, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#0072CE", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  FI: {
    name: "Finland",
    roles: {
      primary: "#002F6C",
      secondary: "#002F6C",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Finland: arc blue, line blue, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#002F6C", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  FR: {
    name: "France",
    roles: {
      primary: "#0055A4",
      secondary: "#EF4135",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "France: arc blue, line red, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#0055A4", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  DE: {
    name: "Germany",
    roles: {
      primary: "#000000",
      secondary: "#DD0000",
      accent: "#FFCE00",
      neutral: "#FFFFFF",
      note: "Germany: arc black, line red, dot yellow.",
    },
    normal: makeTheme("#111827", "#F5F5F3", "#ECECEA", "#D9D9D6", "#000000", "#666666"),
    dark: makeTheme("#F4F4F5", "#0D0D0D", "#18181B", "#2E2E33", "#FFCE00", "#B7B7BC"),
  },
  GR: {
    name: "Greece",
    roles: {
      primary: "#0D5EAF",
      secondary: "#0D5EAF",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Greece: arc blue, line blue, dot white.",
    },
    normal: makeTheme("#102034", "#F4F8FB", "#ECF4F8", "#D3E1E8", "#0D5EAF", "#5D7180"),
    dark: makeTheme("#F3F7FA", "#0A1014", "#111A21", "#263844", "#FFFFFF", "#AAB8C2"),
  },
  HU: {
    name: "Hungary",
    roles: {
      primary: "#477050",
      secondary: "#CE2939",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Hungary: arc green, line red, dot white.",
    },
    normal: makeTheme("#18251F", "#F7FAF7", "#EFF4EF", "#DCE6DC", "#477050", "#68766B"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FFFFFF", "#A5B8A9"),
  },
  IE: {
    name: "Ireland",
    roles: {
      primary: "#169B62",
      secondary: "#FF883E",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Ireland: arc green, line orange, dot white.",
    },
    normal: makeTheme("#18251F", "#F7FAF7", "#EFF4EF", "#DCE6DC", "#169B62", "#68766B"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FFFFFF", "#A5B8A9"),
  },
  IT: {
    name: "Italy",
    roles: {
      primary: "#009246",
      secondary: "#CE2B37",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Italy: arc green, line red, dot white.",
    },
    normal: makeTheme("#18251F", "#F7FAF7", "#EFF4EF", "#DCE6DC", "#009246", "#68766B"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FFFFFF", "#A5B8A9"),
  },
  LV: {
    name: "Latvia",
    roles: {
      primary: "#9E3039",
      secondary: "#9E3039",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Latvia: arc carmine, line carmine, dot white.",
    },
    normal: makeTheme("#231819", "#F7F1EF", "#EFE6E3", "#DDCECA", "#9E3039", "#736764"),
    dark: makeTheme("#F6EEEE", "#130D0E", "#1D1416", "#34262A", "#FFFFFF", "#BCAEB0"),
  },
  LT: {
    name: "Lithuania",
    roles: {
      primary: "#006A44",
      secondary: "#C1272D",
      accent: "#FDB913",
      neutral: "#FFFFFF",
      note: "Lithuania: arc green, line red, dot yellow.",
    },
    normal: makeTheme("#221D16", "#F6F0E4", "#F1E8D8", "#DDD3C3", "#006A44", "#756E63"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FDB913", "#A5B8A9"),
  },
  LU: {
    name: "Luxembourg",
    roles: {
      primary: "#00A3E0",
      secondary: "#EF3340",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Luxembourg: arc blue, line red, dot white.",
    },
    normal: makeTheme("#102034", "#F4F8FB", "#ECF4F8", "#D3E1E8", "#00A3E0", "#5D7180"),
    dark: makeTheme("#F3F7FA", "#0A1014", "#111A21", "#263844", "#FFFFFF", "#AAB8C2"),
  },
  MT: {
    name: "Malta",
    roles: {
      primary: "#CF142B",
      secondary: "#CF142B",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Malta: arc red, line red, dot white.",
    },
    normal: makeTheme("#201819", "#FAF7F7", "#F2ECEC", "#E3D7D8", "#CF142B", "#766A6B"),
    dark: makeTheme("#F6F1F2", "#120D0E", "#1D1416", "#342528", "#FFFFFF", "#BCAEB0"),
  },
  NL: {
    name: "Netherlands",
    roles: {
      primary: "#21468B",
      secondary: "#AE1C28",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Netherlands: arc blue, line red, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#21468B", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  PL: {
    name: "Poland",
    roles: {
      primary: "#DC143C",
      secondary: "#DC143C",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Poland: arc red, line red, dot white.",
    },
    normal: makeTheme("#201819", "#FAF7F7", "#F2ECEC", "#E3D7D8", "#DC143C", "#766A6B"),
    dark: makeTheme("#F6F1F2", "#120D0E", "#1D1416", "#342528", "#FFFFFF", "#BCAEB0"),
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
    normal: makeTheme("#221D16", "#F6F0E4", "#F1E8D8", "#DDD3C3", "#006600", "#756E63"),
    dark: makeTheme("#EEF7F0", "#0B110D", "#121B15", "#263428", "#FFFF00", "#A5B8A9"),
  },
  RO: {
    name: "Romania",
    roles: {
      primary: "#002B7F",
      secondary: "#CE1126",
      accent: "#FCD116",
      neutral: "#FFFFFF",
      note: "Romania: arc blue, line red, dot yellow.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#002B7F", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FCD116", "#A8B3C2"),
  },
  SK: {
    name: "Slovakia",
    roles: {
      primary: "#0B4EA2",
      secondary: "#EE1C25",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Slovakia: arc blue, line red, dot white.",
    },
    normal: makeTheme("#172033", "#F6F8FB", "#EEF2F7", "#D8E0EA", "#0B4EA2", "#64748B"),
    dark: makeTheme("#F3F6FA", "#0D1117", "#151B24", "#263241", "#FFFFFF", "#A8B3C2"),
  },
  SI: {
    name: "Slovenia",
    roles: {
      primary: "#005DA4",
      secondary: "#ED1C24",
      accent: "#FFFFFF",
      neutral: "#FFFFFF",
      note: "Slovenia: arc blue, line red, dot white.",
    },
    normal: makeTheme("#102034", "#F4F8FB", "#ECF4F8", "#D3E1E8", "#005DA4", "#5D7180"),
    dark: makeTheme("#F3F7FA", "#0A1014", "#111A21", "#263844", "#FFFFFF", "#AAB8C2"),
  },
  ES: {
    name: "Spain",
    roles: {
      primary: "#AA151B",
      secondary: "#AA151B",
      accent: "#F1BF00",
      neutral: "#FFFFFF",
      note: "Spain: arc red, line red, dot yellow.",
    },
    normal: makeTheme("#251A12", "#F8F1E5", "#F1E5D2", "#E2D0B8", "#AA151B", "#74675A"),
    dark: makeTheme("#FFF3E6", "#160E0A", "#211611", "#3A2A20", "#F1BF00", "#BFAE9E"),
  },
  SE: {
    name: "Sweden",
    roles: {
      primary: "#006AA7",
      secondary: "#006AA7",
      accent: "#FECC02",
      neutral: "#FFFFFF",
      note: "Sweden: arc blue, line blue, dot yellow.",
    },
    normal: makeTheme("#102034", "#F4F8FB", "#ECF4F8", "#D3E1E8", "#006AA7", "#5D7180"),
    dark: makeTheme("#F3F7FA", "#0A1014", "#111A21", "#263844", "#FECC02", "#AAB8C2"),
  },
};

export type CountryCode = keyof typeof COUNTRY_THEMES;

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
export function resolveThemeVars(country: CountryCode, mode: ThemeMode): Record<string, string> {
  const entry = COUNTRY_THEMES[country] ?? COUNTRY_THEMES[DEFAULT_COUNTRY];
  const theme = mode === "dark" ? entry.dark : entry.normal;
  const highlight = readableHighlight(entry.roles.primary, theme.canvas);
  const logoKeyline = isDark(theme.surfaceSolid) ? "rgba(255,255,255,0.68)" : "rgba(0,0,0,0.48)";

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
    "--color-muted": theme.surfaceSolid,
    // Corrected against the muted SURFACE rather than the canvas: it is the tighter of the two
    // backgrounds this text lands on, and the table's raw values sit at 4.15–4.44:1 on the light
    // themes — below AA, and below the 4.89:1 the hand-tuned globals.css value already reached.
    "--color-muted-foreground": readableHighlight(theme.muted, theme.surfaceSolid),
    "--color-border": theme.border,
    "--color-hover": theme.hover,
    "--ui-accent": theme.accent,
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
    "--semantic-success-readable": readableHighlight(
      SEMANTIC_TOKENS["--semantic-success"],
      theme.canvas,
    ),
    "--semantic-warning-readable": readableHighlight(
      SEMANTIC_TOKENS["--semantic-warning"],
      theme.canvas,
    ),
    "--semantic-danger-readable": readableHighlight(
      SEMANTIC_TOKENS["--semantic-danger"],
      theme.canvas,
    ),
    "--semantic-info-readable": readableHighlight(SEMANTIC_TOKENS["--semantic-info"], theme.canvas),
  };
}

export function isCountryCode(value: string): value is CountryCode {
  return Object.prototype.hasOwnProperty.call(COUNTRY_THEMES, value);
}

/**
 * The country's name in the reader's language.
 *
 * `COUNTRY_THEMES[code].name` is an English string in a 28-country table, so anything rendering
 * it said "Spain" to a Portuguese reader, and would have said "Germany" and "France" to them too.
 * Translating the table would mean 28 names times four catalogues, maintained by hand, growing
 * with every country added.
 *
 * `Intl.DisplayNames` already knows them, in every locale the app has and every one it might add:
 * ES renders as Espanha / España / Spagna / Spain with nothing to maintain. It even covers the
 * table's one non-ISO entry — EU comes back as "União Europeia".
 *
 * The table's `name` stays as the fallback for a code the platform does not recognise.
 *
 * Lives here rather than beside its first caller because it has a second one: the portfolio tree
 * names the country of a cluster, and the Finances tax estimate names the country of a regime.
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

/**
 * A language's name, written in the reader's own language.
 *
 * Same argument as `countryLabel` above, one `Intl.DisplayNames` type over: the tenant modal
 * offers the four catalogues as a choice, and hardcoding "Portuguese / Spanish / English /
 * Italian" would be four names times four catalogues maintained by hand for something the
 * platform already knows. A Portuguese reader gets "Português, Espanhol, Inglês, Italiano".
 *
 * Falls back to the code itself, which is honest — an unrecognised tag is better shown raw than
 * guessed at.
 */
export function languageLabel(code: string, locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    if (display && display !== code) return display;
  } catch {
    // Unsupported locale or a tag that is not a language — fall through to the code.
  }
  return code;
}
