import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DARK_THEME_COLOR } from "@/lib/theme/boot-script";

import manifest from "./manifest";

/**
 * An installed app's splash screen is built by Android from this file: the background colour and
 * the icon. It said light cream and a different green for the status bar, over an app that is
 * dark first, so the first frame and the page disagreed. And the long-press menu offered
 * "Operations", a page that does not exist.
 */
const ROOT = join(import.meta.dirname, "..");
const { background_color, theme_color, shortcuts = [], icons = [] } = manifest();

describe("web app manifest", () => {
  it("opens on the app's own dark colour, for the splash and the status bar", () => {
    expect(background_color).toBe(DARK_THEME_COLOR);
    expect(theme_color).toBe(DARK_THEME_COLOR);
  });

  it("has the icons Android needs for a splash: 192, 512 and a maskable one", () => {
    const sizes = icons.map((icon) => `${icon.sizes}:${icon.purpose ?? "any"}`);
    expect(sizes).toEqual(
      expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]),
    );
  });

  it.each(shortcuts.map((s) => [s.name, s.url] as const))(
    "the %s shortcut (%s) opens a page that exists",
    (_name, url) => {
      const dir = join(ROOT, "app", "[locale]", "(main)", url.replace(/^\//, ""));
      expect(existsSync(join(dir, "page.tsx")), `${url} has no page`).toBe(true);
    },
  );
});
