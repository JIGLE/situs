// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing on a screen announces a feature that is not there.
 *
 * The property detail's month sheet carried two disabled buttons under a "Coming soon" heading,
 * "Link a bank movement" and "Issue rent receipt to the tax authority", to show the shape of a
 * sheet whose backend did not exist. Both did exist by then, elsewhere (the Bank Movements inbox
 * links a movement, Finance › Recibos issues a receipt), so the sheet advertised work it could not
 * do and pointed at nothing. A feature that is not built is not on the screen.
 *
 * Catches the way it was written: a catalogue key, or a use of one, named for "coming soon".
 */

const ROOT = join(__dirname, "..");
const LOCALES = ["en", "pt", "es", "it"];
const STUB_KEY = /^(comingSoon|coming_soon|soon|notAvailableYet)$/i;

function keysOf(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    `${path}${key}`,
    ...keysOf(child, `${path}${key}.`),
  ]);
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("no stub announces a feature that is not built", () => {
  it.each(LOCALES)("%s: no message key is named for 'coming soon'", (locale) => {
    const catalogue = JSON.parse(readFileSync(join(ROOT, "messages", `${locale}.json`), "utf8"));
    const stubs = keysOf(catalogue).filter((key) => STUB_KEY.test(key.split(".").pop() ?? ""));

    expect(stubs, `${locale}.json has: ${stubs.join(", ")}`).toEqual([]);
  });

  it("no component or page asks for one", () => {
    const offenders: string[] = [];
    for (const dir of ["components", "app"]) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (/t\(\s*["'`][\w.]*\.?(comingSoon|coming_soon)["'`]/.test(line)) {
              offenders.push(`${file.slice(ROOT.length + 1)}:${index + 1}`);
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });
});
