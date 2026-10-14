import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Settings and Administration draw their panels with `Panel`, and the tab style is written once.
 *
 * Settings drew `Card`s with a large title and an icon, the Access screens hand-built sections
 * with a medium title, the control center ruled tiles with a small capitalised one, and the danger
 * box its own border. The Admin section bar copied `TabsTrigger`'s class string by hand. A change
 * to either had to be made in every copy and reached only the ones remembered.
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

const SETTINGS_AND_ADMIN = [
  ...walk(join(root, "components/features/settings")),
  ...walk(join(root, "components/features/admin")),
];

describe("Settings and Administration use Panel", () => {
  it("draw no Card", () => {
    const found = offenders(SETTINGS_AND_ADMIN, /<Card[\s>]|<CardHeader|<CardTitle|ui\/card"/);
    expect(found, `use <Panel> from components/shared/panel:\n${found.join("\n")}`).toEqual([]);
  });

  it("hand-build no panel", () => {
    const found = offenders(
      SETTINGS_AND_ADMIN,
      /<section[^>]*className="[^"]*border[^"]*bg-\[var\(--color-(background|card|surface-solid)\)\]/,
    );
    expect(found, `use <Panel> from components/shared/panel:\n${found.join("\n")}`).toEqual([]);
  });
});

describe("the tab style is written once", () => {
  it("keeps the active tab's accent edge in components/ui/tabs.tsx and nowhere else", () => {
    const everything = [...walk(join(root, "components")), ...walk(join(root, "app"))].filter(
      (file) => relative(root, file) !== "components/ui/tabs.tsx",
    );
    const found = offenders(everything, /border-t-\[var\(--country-highlight-readable\)\]/);
    expect(
      found,
      `a tab is <TabsTrigger> or <TabLink>, not a copy of their classes:\n${found.join("\n")}`,
    ).toEqual([]);
  });
});
