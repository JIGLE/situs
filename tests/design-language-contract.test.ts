import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * docs/DESIGN_LANGUAGE.md names the test behind every part of the design language. A page that
 * names a guard which does not exist is a promise nobody keeps, and a design guard the page does
 * not name is a rule nobody can find, so this refuses both.
 */
const root = join(import.meta.dirname, "..");
const doc = readFileSync(join(root, "docs/DESIGN_LANGUAGE.md"), "utf8");

const named = [...new Set([...doc.matchAll(/`(tests\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1]))];

/** Contract tests that guard something other than how the interface looks. */
const NOT_DESIGN = new Set([
  "admin-session-fallback-contract.test.ts",
  "api-envelope-contract.test.ts",
  "bank-rawdata-redaction-contract.test.ts",
  "error-copy-contract.test.ts",
  "legal-pages-contract.test.ts",
  "page-metadata-contract.test.ts",
  "pii-backfill-contract.test.ts",
  "receipt-writers-contract.test.ts",
]);

const contracts = readdirSync(join(root, "tests")).filter((f) => f.endsWith("-contract.test.ts"));

describe("design language", () => {
  it("names at least the guards it was written with", () => {
    expect(named.length).toBeGreaterThanOrEqual(10);
  });

  it("names only guards that exist", () => {
    expect(named.filter((path) => !existsSync(join(root, path)))).toEqual([]);
  });

  it("names every design contract test", () => {
    const missing = contracts.filter((f) => !NOT_DESIGN.has(f) && !named.includes(`tests/${f}`));
    expect(missing).toEqual([]);
  });

  it("lists as not-design only tests that exist", () => {
    expect([...NOT_DESIGN].filter((f) => !contracts.includes(f))).toEqual([]);
  });
});
