import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A state is a `StatusMark`, and which tone a stored value takes is decided in one file.
 *
 * Status was a solid `Badge`, an outlined mono `Badge`, a soft-washed pill built by hand in seven
 * places, a coloured word, and raw palette colours (`text-amber-500`, `text-sky-600`); the same
 * lease was grey in the list and red on its own page. This reads the source and names file and
 * line.
 */
const root = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const codeLines = (source: string) =>
  source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));

function offenders(files: string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const { line, number } of codeLines(readFileSync(file, "utf8"))) {
      if (pattern.test(line))
        found.push(`${relative(root, file)}:${number}  ${line.trim().slice(0, 90)}`);
    }
  }
  return found;
}

const SOURCES = [
  ...walk(join(root, "components")),
  ...walk(join(root, "app")),
  ...walk(join(root, "lib")),
];

describe("a state is a StatusMark", () => {
  it("is never a status Badge", () => {
    const found = offenders(
      SOURCES.filter((f) => relative(root, f) !== "components/ui/badge.tsx"),
      /<Badge[^>]*variant="(success|warning|destructive|info|status[\w-]*)"/,
    );
    expect(found, `use <StatusMark> from components/ui/status-mark:\n${found.join("\n")}`).toEqual(
      [],
    );
  });

  it("is never a pill washed in a semantic colour", () => {
    const found = offenders(
      SOURCES,
      /semantic-(success|warning|danger|info)-soft[^"]*px-(1\.5|2|2\.5|3) py-(0\.5|1)\b|px-(1\.5|2|2\.5|3) py-(0\.5|1)\b[^"]*semantic-(success|warning|danger|info)-soft/,
    );
    expect(found, `use <StatusMark> from components/ui/status-mark:\n${found.join("\n")}`).toEqual(
      [],
    );
  });

  it("is never coloured with a raw palette hue", () => {
    const found = offenders(
      SOURCES,
      /<Badge[^>]*text-(amber|sky|emerald|red|green|yellow|blue|orange)-\d/,
    );
    expect(found, `a state's colour is its tone, not a palette hue:\n${found.join("\n")}`).toEqual(
      [],
    );
  });

  it("takes its tone from lib/utils/status-tone.ts, not from a table of colours per screen", () => {
    const found = offenders(
      SOURCES.filter((f) => relative(root, f) !== "lib/utils/status-tone.ts"),
      /\b(STATUS_STYLES|STAGE_STYLES|PAYMENT_STATUS_STYLES|STATUS_VARIANT|PAYMENT_STATUS_VARIANT)\b/,
    );
    expect(found, `ask lib/utils/status-tone.ts:\n${found.join("\n")}`).toEqual([]);
  });
});
