import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrastRatio, mixWith } from "@/lib/design/country-themes";

/**
 * Status text in the dark theme, read from the stylesheet the app ships.
 *
 * Dark is the default, and 57 places set text in `--color-success`, `--color-warning`,
 * `--color-error` or `--color-info`, usually on the matching `-muted` wash (a badge). The light
 * default had hidden that the dark values were a hair short of 4.5:1 on those washes (the success
 * green read 4.25:1 on its own badge), which the accessibility E2E reported once dark was default.
 */
const css = readFileSync(join(import.meta.dirname, "..", "app/globals.css"), "utf8");
const start = css.indexOf('[data-mode="dark"],');
const dark = css.slice(start, css.indexOf("\n}", start));

function token(name: string): string {
  const match = dark.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
  if (!match) throw new Error(`--${name} is not a hex colour in the dark block`);
  return match[1];
}

const canvas = token("color-background");
const card = mixWith(canvas, "#FFFFFF", 0.035);
const HUES = {
  success: "#166534",
  warning: "#B45309",
  error: "#B91C1C",
  info: "#1D4ED8",
} as const;

describe("dark status text", () => {
  it.each(Object.entries(HUES))(
    "--color-%s reads on the canvas, a card and its own wash",
    (key, hue) => {
      const text = token(`color-${key}`);
      const wash = mixWith(canvas, hue, 0.15);
      const washOnCard = mixWith(card, hue, 0.15);

      for (const background of [canvas, card, wash, washOnCard]) {
        expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("--color-destructive is the error colour", () => {
    expect(token("color-destructive")).toBe(token("color-error"));
  });
});
