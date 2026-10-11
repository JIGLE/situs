/**
 * The theme choices, and the one place a stored value becomes one.
 *
 * Pure, so the server (`app/layout.tsx` reads the cookie), the provider and the tests all say the
 * same thing. `lib/theme/boot-script.ts` carries a copy of the mapping as a string, because it
 * runs before any module loads; `lib/theme/boot-script.test.tsx` holds the two together.
 */
export type ThemeMode = "normal" | "dark" | "system";

/** The cookie the server renders the theme from. Not a secret: it holds one of the three words. */
export const MODE_COOKIE = "situs-mode";

export const MODE_COOKIE_MAX_AGE_SECONDS = 31536000;

/** Map pre-Situs theme names (light/dark/dark-oled) onto the Situs modes. */
export function normalizeMode(value: string | null | undefined): ThemeMode | null {
  switch (value) {
    case "normal":
    case "light":
      return "normal";
    case "dark":
    case "dark-oled":
      return "dark";
    case "system":
      return "system";
    default:
      return null;
  }
}
