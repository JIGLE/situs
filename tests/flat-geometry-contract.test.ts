import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The language is square and flat: no corner radius but the circle, no shadow but the modal's, no
 * press-down scale.
 *
 * Every `--radius-*` step is 0 in `globals.css`, so `rounded-lg` already draws square, and the
 * source said otherwise: 150 `rounded-*` and 35 `shadow-*` classes read as a rounded, raised design
 * to anyone copying a component. Bare `rounded` is worse: Tailwind v4 draws it as a literal 0.25rem
 * that ignores the token, so ten places were quietly round. Deleting the classes made the source
 * say what the screen shows; this keeps it so.
 *
 * What stays is named: `rounded-full` is the deliberate circle (dots, avatars, spinners), and the
 * PWA banner keeps `--shadow-modal`, the one depth the language has.
 *
 * This reads the source and names file and line.
 */
const root = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Lines that are code, not commentary about the old style. */
const codeLines = (source: string) =>
  source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));

/**
 * A class token: a whole word between whitespace or quotes, with any variants in front of it
 * (`md:`, `hover:`, `data-[state=open]:`).
 */
const CLASS = String.raw`(?<![^\s"'\x60])(?:[^\s"'\x60]*:)?`;
const END = String.raw`(?![^\s"'\x60])`;

const RULES: { name: string; pattern: RegExp; allowed?: Record<string, RegExp> }[] = [
  {
    name: "a corner radius other than the circle (`rounded-full`)",
    pattern: new RegExp(`${CLASS}rounded(?:-(?!full${END})[a-z0-9\\[][^\\s"'\`]*)?${END}`),
  },
  {
    name: "a shadow other than the modal's (`shadow-[var(--shadow-modal)]`)",
    pattern: new RegExp(`${CLASS}shadow(?:-[^\\s"'\`]+)?${END}`),
    allowed: { "components/shared/pwa-register.tsx": /shadow-\[var\(--shadow-modal\)\]/ },
  },
  {
    name: "a scale transform on press or hover",
    pattern: new RegExp(`${CLASS}(?:active|hover|focus):scale-[^\\s"'\`]+${END}`),
  },
];

const files = [...walk(join(root, "components")), ...walk(join(root, "app"))];

describe("geometry is square and flat in the source", () => {
  for (const rule of RULES) {
    it(`has no ${rule.name}`, () => {
      const found: string[] = [];
      for (const file of files) {
        const rel = relative(root, file);
        for (const { line, number } of codeLines(readFileSync(file, "utf8"))) {
          const hit = line.match(rule.pattern);
          if (!hit) continue;
          if (rule.allowed?.[rel]?.test(line)) continue;
          found.push(`${rel}:${number}  ${line.trim().slice(0, 90)}`);
        }
      }
      expect(found, `${rule.name}:\n${found.join("\n")}`).toEqual([]);
    });
  }
});
