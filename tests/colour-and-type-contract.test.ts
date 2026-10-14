import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cn } from "@/lib/utils/utils";

/**
 * Colour comes from the theme's tokens and type from six named sizes.
 *
 * A raw palette hue (`text-red-500`, `from-violet-500/20`) never changes with the theme or the
 * country, and a label could be 9, 10, 11, 12, 13 or 15px by whim. This reads the source and names
 * file and line.
 */
const root = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const SOURCES = [...walk(join(root, "app")), ...walk(join(root, "components"))];

const codeLines = (source: string) =>
  source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line));

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of SOURCES) {
    for (const { line, number } of codeLines(readFileSync(file, "utf8"))) {
      if (pattern.test(line))
        found.push(`${relative(root, file)}:${number}  ${line.trim().slice(0, 90)}`);
    }
  }
  return found;
}

const FAMILY =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";

describe("colour and type", () => {
  it("uses no raw palette hue", () => {
    const pattern = new RegExp(
      `\\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow)-(?:${FAMILY})-[0-9]{2,3}\\b`,
    );
    expect(offenders(pattern)).toEqual([]);
  });

  it("uses no `dark:` variant: the semantic tokens already follow the theme", () => {
    expect(offenders(/["'`\s]dark:[a-z[]/)).toEqual([]);
  });

  it("uses no arbitrary pixel font size", () => {
    expect(offenders(/\btext-\[[0-9.]+px\]/)).toEqual([]);
  });

  it("defines every named size it allows, and uses each", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    const used = SOURCES.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const name of ["label", "badge", "caption", "meta", "reading", "tick"]) {
      expect(css, `@utility text-${name}`).toContain(`@utility text-${name} {`);
      expect(used, `text-${name} unused`).toMatch(new RegExp(`\\btext-${name}\\b`));
    }
  });
});

describe("cn and the type scale", () => {
  it("keeps a named size when a text colour follows", () => {
    expect(cn("text-label", "text-[var(--color-muted-foreground)]")).toBe(
      "text-label text-[var(--color-muted-foreground)]",
    );
  });

  it("lets a later size replace an earlier one", () => {
    expect(cn("text-label", "text-sm")).toBe("text-sm");
  });
});
