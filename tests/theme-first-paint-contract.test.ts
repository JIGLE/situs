import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What the first byte of the page says about the theme.
 *
 * `app/layout.tsx` is the one place the document's starting theme is written. It renders dark, so
 * a page that has not run any script is already the dark brand, and it inlines the boot script,
 * with the page's CSP nonce, so a device that chose light is corrected before anything is drawn.
 * A layout that lost either would bring the light flash back with every test still green.
 */
const layout = readFileSync(join(import.meta.dirname, "..", "app/layout.tsx"), "utf8");

describe("the root layout's theme", () => {
  it("renders the document dark before any script runs", () => {
    expect(layout).toMatch(/data-mode="dark"/);
    expect(layout).toMatch(/data-theme="dark"/);
    expect(layout).toMatch(/colorScheme:\s*"dark"/);
    expect(layout).not.toMatch(/data-mode="normal"/);
  });

  it("inlines the boot script in the head, under the CSP nonce", () => {
    expect(layout).toMatch(/<script[^>]*nonce=\{nonce[^}]*\}[\s\S]*?dangerouslySetInnerHTML/);
    expect(layout).toMatch(/__html:\s*THEME_BOOT_SCRIPT/);
  });

  it("leaves the one status-bar tag to the boot script, whatever the phone's own setting", () => {
    // The boot script owns the tag. One rendered by React, or by Next's `viewport.themeColor`, is
    // duplicated at hydration, beside the one the script already moved.
    expect(layout).not.toMatch(/themeColor:/);
    expect(layout).not.toMatch(/<meta[^>]*name="theme-color"/);
    expect(layout).not.toMatch(/prefers-color-scheme/);
  });
});
