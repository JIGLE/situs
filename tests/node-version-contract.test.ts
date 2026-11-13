import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CI tests on the Node the image ships.
 *
 * The workflows read their Node version from `.nvmrc` (`node-version-file`), and the image takes
 * its own from the Dockerfile's `FROM node:<major>-alpine`, which Dependabot bumps. Those two
 * drifted once already: CI ran on Node 22 while the image moved to Node 26, so no CI run had
 * tested the runtime that served production. A Dependabot bump of the base image now fails this
 * test until `.nvmrc` follows, which puts the CI change in the same pull request.
 */

const root = process.cwd();

describe("node version", () => {
  it("every Dockerfile stage uses the major .nvmrc names", () => {
    const nvmrc = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
    const major = nvmrc.split(".")[0];
    const stages = [
      ...readFileSync(join(root, "Dockerfile"), "utf8").matchAll(/^FROM node:(\d+)/gm),
    ].map((m) => m[1]);

    // Positive control: a regex that stopped matching would make the check below vacuous.
    expect(stages.length).toBeGreaterThan(0);
    expect(major).toMatch(/^\d+$/);
    expect(
      stages.every((s) => s === major),
      `.nvmrc says ${major}, Dockerfile says ${stages}`,
    ).toBe(true);
  });
});
