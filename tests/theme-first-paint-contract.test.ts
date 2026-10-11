import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the first byte of the page says about the theme.
 *
 * `app/layout.tsx` is the one place the document's starting theme is written. It draws the theme
 * the device chose (the `situs-mode` cookie) into the HTML itself, and dark for a device that never
 * chose, so a page that has not run any script is already right. It also inlines the boot script,
 * with the page's CSP nonce, which covers a device the server has not seen choose yet (and one
 * that follows its phone). A layout that lost any of it would bring the light flash back with
 * every test still green.
 */
const layout = readFileSync(join(import.meta.dirname, "..", "app/layout.tsx"), "utf8");

describe("the root layout's theme", () => {
  it("reads the device's choice from the cookie, through the shared mapping", () => {
    expect(layout).toMatch(
      /import \{[^}]*MODE_COOKIE[^}]*normalizeMode[^}]*\} from "@\/lib\/theme\/mode"/,
    );
    expect(layout).toMatch(/normalizeMode\(\(await cookies\(\)\)\.get\(MODE_COOKIE\)\?\.value\)/);
  });

  it("draws light only for a device that chose light, and dark for everyone else", () => {
    expect(layout).toMatch(/const light = chosen === "normal"/);
    expect(layout).toMatch(/data-mode=\{light \? "normal" : "dark"\}/);
    expect(layout).toMatch(/data-theme=\{light \? "light" : "dark"\}/);
    expect(layout).toMatch(/colorScheme: light \? "light" : "dark"/);
    // Nothing hardcodes a theme any more: a literal would ignore the cookie.
    expect(layout).not.toMatch(/data-mode="(dark|normal)"/);
  });

  it("inlines the boot script in the head, under the CSP nonce", () => {
    expect(layout).toMatch(/<script[^>]*nonce=\{nonce[^}]*\}[\s\S]*?dangerouslySetInnerHTML/);
    expect(layout).toMatch(/__html:\s*THEME_BOOT_SCRIPT/);
  });

  it("renders the status-bar tag only for an explicit choice, with the value the script writes", () => {
    // A tag whose content the script then changes (a device that follows its phone) is duplicated
    // by React at hydration, beside the one the theme set. Next's `viewport.themeColor` always is.
    expect(layout).not.toMatch(/themeColor:/);
    expect(layout).toMatch(/const explicit = chosen === "normal" \|\| chosen === "dark"/);
    expect(layout).toMatch(
      /\{explicit && \(\s*<meta name="theme-color" content=\{light \? LIGHT_THEME_COLOR : DARK_THEME_COLOR\} \/>\s*\)\}/,
    );
    expect(layout).not.toMatch(/prefers-color-scheme/);
  });
});

describe("the sign-in pages can change the theme", () => {
  it("mounts the provider that `app/[locale]/layout.tsx` does not reach", () => {
    const auth = readFileSync(join(import.meta.dirname, "..", "app/auth/layout.tsx"), "utf8");

    expect(auth).toMatch(/<ThemeProvider>/);
  });

  it("puts the switcher beside the language control", () => {
    const view = readFileSync(
      join(import.meta.dirname, "..", "components/features/auth/auth-view.tsx"),
      "utf8",
    );

    expect(view).toMatch(/<ThemeSwitcher \/>\s*<LanguageSelector \/>/);
  });
});
