import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `playwright` and `playwright-core` ship together and `playwright` asks for exactly its own
 * version of the core. An `overrides` entry that pins `playwright-core` to an older version, which
 * this repo carried, installs a core the runner cannot load: every worker dies with
 * `createCallIdGenerator is not a function` before one test runs, while type-check, lint and the
 * unit tests stay green. That is how Dependabot's Playwright bump arrived red on the E2E jobs only.
 *
 * Reads the two files, so the mismatch fails here, in the unit suite, naming both versions.
 */
const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  overrides?: Record<string, unknown>;
};
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

describe("Playwright's packages agree", () => {
  it("installs the core version playwright asks for", () => {
    const runner = lock.packages["node_modules/playwright"];
    const core = lock.packages["node_modules/playwright-core"];

    expect(
      core?.version,
      `playwright ${runner?.version} asks for playwright-core ${runner?.dependencies?.["playwright-core"]}, the lockfile holds ${core?.version}`,
    ).toBe(runner?.dependencies?.["playwright-core"]);
  });

  it("does not pin the core with an override, which a runner bump would then contradict", () => {
    expect(
      Object.keys(pkg.overrides ?? {}),
      "remove the playwright-core entry from overrides in package.json",
    ).not.toContain("playwright-core");
  });
});
