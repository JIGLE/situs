import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A page shell is as tall as the VISIBLE viewport, never the largest one.
 *
 * `vh` is the largest the viewport can be. In an installed Android app that is taller than what is
 * on screen (the system bars take the difference), so a `100vh` page scrolls by that much and a
 * fixed bottom bar sits below the fold. `dvh` follows the visible height. The sign-in page
 * scrolled inside the owner's installed app for exactly this reason, and no browser test can see
 * it (Chromium's `vh` equals its window), so this reads the source.
 */
const root = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.(tsx|ts)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Lines that are code, not commentary about the old unit. */
const codeLines = (source: string) =>
  source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

/** The one deliberate `vh`: the desktop rail's height, `lg` and up only, where there are no system bars. */
const ALLOWED = new Set(["components/features/property/property-list.tsx"]);

describe("page shells use the visible viewport", () => {
  it("no component sizes a page with h-screen, min-h-screen or 100vh", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of walk(join(root, dir))) {
        const rel = relative(root, file);
        if (ALLOWED.has(rel)) continue;
        codeLines(readFileSync(file, "utf8")).forEach((line, index) => {
          if (/(?<![\w-])(min-h-screen|h-screen)(?![\w-])|\b100vh\b/.test(line)) {
            offenders.push(`${rel}:${index + 1}  ${line.trim().slice(0, 90)}`);
          }
        });
      }
    }

    expect(offenders, `use min-h-dvh / h-dvh:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every 100vh in the stylesheet is followed by a 100dvh for the same property", () => {
    const lines = readFileSync(join(root, "app/globals.css"), "utf8").split("\n");
    const bare: string[] = [];
    lines.forEach((line, index) => {
      const match = line.match(/^\s*([a-z-]+):\s*100vh;/);
      if (!match) return;
      const next = lines.slice(index + 1, index + 10).join("\n");
      if (!new RegExp(`${match[1]}:\\s*100dvh;`).test(next)) bare.push(`globals.css:${index + 1}`);
    });

    expect(bare).toEqual([]);
  });

  it("an installed app does not bounce or refresh by pulling a page that fits", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    expect(css).toMatch(
      /@media \(display-mode: standalone\)\s*\{[^}]*html\s*\{[^}]*overscroll-behavior-y:\s*none/,
    );
  });
});
