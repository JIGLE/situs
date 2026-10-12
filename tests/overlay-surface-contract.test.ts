import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * An overlay is solid and flat: an opaque surface token, a hairline border, no blur, no raised shadow.
 *
 * The design language is flat and ruled (`CLAUDE.md`, `globals.css`). Menus and selects painted
 * themselves with `bg-[var(--color-card)]/95`, but `--color-card` is a 3.5% white wash in the dark
 * theme, so the list was about 3% opaque: in Settings the country select let the text behind it show
 * through, under a `backdrop-blur-md` and a `shadow-xl` that the language does not have. `--color-popover`
 * is the solid token that was there all along.
 *
 * This reads the source, since a rendered test cannot tell a 3%-opaque wash from a solid one by looking
 * at class names, and names the file and line.
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
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));

function offendersIn(files: string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const { line, number } of codeLines(readFileSync(file, "utf8"))) {
      if (pattern.test(line))
        found.push(`${relative(root, file)}:${number}  ${line.trim().slice(0, 90)}`);
    }
  }
  return found;
}

/** The surfaces that float over the page. */
const OVERLAYS = [
  "components/ui/dropdown-menu.tsx",
  "components/ui/select.tsx",
  "components/ui/popover.tsx",
  "components/ui/dialog.tsx",
  "components/ui/alert-dialog.tsx",
  "components/ui/sheet.tsx",
  "components/ui/bulk-action-bar.tsx",
].map((f) => join(root, f));

const everything = [...walk(join(root, "components")), ...walk(join(root, "app"))];

/** The legal pages still blur their header; they move onto the theme tokens in their own change. */
const BLUR_UNTIL_LEGAL_PAGES_MOVE = new Set([
  "app/[locale]/privacy/page.tsx",
  "app/[locale]/terms/page.tsx",
]);

describe("overlays are solid and flat", () => {
  it("nothing blurs what is behind it", () => {
    const offenders = offendersIn(
      everything.filter((f) => !BLUR_UNTIL_LEGAL_PAGES_MOVE.has(relative(root, f))),
      /backdrop-blur/,
    );
    expect(
      offenders,
      `backdrop-blur is not part of the language:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no overlay is painted with the translucent card wash", () => {
    const offenders = offendersIn(OVERLAYS, /bg-\[var\(--color-card\)\]/);
    expect(offenders, `use --color-popover, an opaque token:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no overlay carries a raised shadow", () => {
    const offenders = offendersIn(OVERLAYS, /(?<![\w-])shadow-(lg|xl|2xl)\b/);
    expect(offenders, `a hairline border does the job:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the scrim behind a modal is a plain dim, not a blur", () => {
    for (const file of ["dialog", "alert-dialog", "sheet"]) {
      const source = readFileSync(join(root, `components/ui/${file}.tsx`), "utf8");
      expect(source, `${file}.tsx scrim`).toMatch(/bg-black\/60/);
    }
  });

  it("the UI primitives follow the app's theme, not the phone's", () => {
    // Tailwind v4's `dark:` is `prefers-color-scheme`, so a phone in dark with the app set to Light would
    // draw the dark item colours on a light menu. The primitives take their colours from the tokens.
    const offenders = offendersIn(
      walk(join(root, "components/ui")),
      /(?<![\w-])dark:|(?:bg|text|border)-zinc-\d/,
    );
    expect(offenders, `use the theme tokens:\n${offenders.join("\n")}`).toEqual([]);
  });
});
