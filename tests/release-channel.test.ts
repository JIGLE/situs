import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, readFileSync as read } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load } from "js-yaml";

/**
 * Only a tag push may claim `:latest` or a bare version number.
 *
 * This rule is not theoretical. `deploy-ghcr.yml` records the incident that produced it:
 * `ghcr.io/jigle/situs:1.24.0` was once built from commit `43997fd` while the git tag `v1.24.0`
 * pointed somewhere else, and `:latest` moved onto unreleased code at the same time. A version
 * number that does not mean the source it was cut from is worse than no version number, because
 * it is trusted.
 *
 * Adding the `main` development channel is exactly the change that could bring that back — one
 * stray `,:latest` in the wrong branch and every production pull silently follows an untested
 * merge. So this runs the workflow's ACTUAL tag-decision script under each ref and asserts what
 * comes out, rather than grepping the file for a string. A text match would pass on a script that
 * had been restructured into being wrong.
 */

interface Workflow {
  jobs: Record<string, { steps?: { id?: string; run?: string }[] }>;
}

const WORKFLOW = join(process.cwd(), ".github", "workflows", "deploy-ghcr.yml");

/**
 * A version token safe to paste into a shell script.
 *
 * This value is substituted into bash source that is then executed, so it is an injection
 * surface. It was previously escaped with `.replace(/"/g, '\\"')`, which escapes the quote but
 * not the backslash — so a value ending in `\` escapes its own escape and the quote breaks out
 * anyway. CodeQL flags that as `js/incomplete-sanitization`, and it is right to.
 *
 * Escaping this correctly is fiddly and easy to get wrong a second time. Every caller passes a
 * version string, so require one and drop the escaping entirely: rejecting the bad input is a
 * stronger guarantee than sanitizing it.
 */
const SAFE_VERSION = /^[A-Za-z0-9._-]*$/;

/** The `Set variables` step's shell script, with GitHub expressions resolved for local execution. */
function decisionScript(inputVersion: string): string {
  if (!SAFE_VERSION.test(inputVersion)) {
    throw new Error(
      `decisionScript: version must be a plain version token, got ${JSON.stringify(inputVersion)}`,
    );
  }

  const workflow = load(readFileSync(WORKFLOW, "utf8")) as Workflow;
  const step = workflow.jobs.deploy.steps?.find((s) => s.id === "vars");
  if (!step?.run) throw new Error("deploy-ghcr.yml: no step with id 'vars' — has it been renamed?");

  return (
    step.run
      // `${{ … }}` is evaluated by Actions, not bash. Blank any that remain, so the branching
      // logic itself is what runs. The inputs reach the script as environment variables
      // (`tagsFor` sets them), never as pasted expressions; the last test below holds that.
      .replace(/\$\{\{[^}]*\}\}/g, "")
  );
}

/**
 * Run the script for a ref and return the `tags=` value it would set. `event` is what started the
 * run: `workflow_run` is a merge to main whose CI passed, `workflow_dispatch` a manual run.
 */
function tagsFor(ref: string, inputVersion = "", event = "workflow_dispatch"): string[] {
  const dir = mkdtempSync(join(tmpdir(), "deploy-vars-"));
  const outputFile = join(dir, "github_output");
  writeFileSync(outputFile, "");
  const script = join(dir, "vars.sh");
  writeFileSync(script, decisionScript(inputVersion));
  if (event === "workflow_run" && ref !== "refs/heads/main") {
    throw new Error("tagsFor: a workflow_run here only ever comes from CI on main");
  }

  execFileSync("bash", [script], {
    env: {
      ...process.env,
      GITHUB_REF: ref,
      GITHUB_REPOSITORY: "JIGLE/situs",
      BUILD_SHA: "abc1234def5678",
      GITHUB_OUTPUT: outputFile,
      INPUT_VERSION: inputVersion,
      INPUT_PLATFORMS: "",
      INPUT_DRY_RUN: "",
      EVENT: event,
    },
    stdio: "pipe",
  });

  const line = read(outputFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("tags="));
  if (!line) throw new Error("the vars step set no `tags` output");
  return line.slice("tags=".length).split(",").filter(Boolean);
}

const claimsLatest = (tags: string[]) => tags.some((t) => t.endsWith(":latest"));

describe("release channel", () => {
  it("a tag push claims the version and :latest", () => {
    // The positive control. Without it, "never emit :latest" would pass every case below and
    // releases would silently stop updating production.
    const tags = tagsFor("refs/tags/v1.25.0");

    expect(tags).toContain("ghcr.io/jigle/situs:1.25.0");
    expect(claimsLatest(tags)).toBe(true);
  });

  it("a merge to main whose CI passed publishes :main and the commit, never :latest", () => {
    const tags = tagsFor("refs/heads/main", "", "workflow_run");

    expect(tags).toContain("ghcr.io/jigle/situs:main");
    expect(tags).toContain("ghcr.io/jigle/situs:sha-abc1234");
    expect(claimsLatest(tags)).toBe(false);
  });

  it("a manual dispatch from main does not move :main", () => {
    // `:main` means "the newest merge CI passed". A dispatch did not come through CI, so it is
    // named after its commit only.
    const tags = tagsFor("refs/heads/main");

    expect(tags).toEqual(["ghcr.io/jigle/situs:sha-abc1234"]);
  });

  it("a manual dispatch with a pre-release name takes only that name", () => {
    const tags = tagsFor("refs/heads/main", "1.25.0-rc1");

    expect(tags).toEqual(["ghcr.io/jigle/situs:1.25.0-rc1"]);
    expect(claimsLatest(tags)).toBe(false);
  });

  it("a bare version on a dispatch is refused and falls back to the commit", () => {
    // A bare number is reserved for tag pushes; accepting it here is how an image gets a release
    // identity it did not earn.
    const tags = tagsFor("refs/heads/main", "1.25.0");

    expect(tags.some((t) => t.endsWith(":1.25.0"))).toBe(false);
    expect(tags).toContain("ghcr.io/jigle/situs:sha-abc1234");
  });

  it("refuses a version that is not a plain token, rather than escaping it", () => {
    // The harness writes this value into a shell script and runs it. `1.0"; touch pwned; #`
    // used to be passed through a quote-escaper that did not escape backslashes; now anything
    // outside the version charset is rejected before it reaches bash.
    //
    // If you prove this guard by deleting it, the payload really does run and leaves an empty
    // `pwned` in the repo root — that is the demonstration, and it is yours to clean up.
    expect(() => tagsFor("refs/heads/main", '1.0"; touch pwned; #')).toThrow(/plain version token/);
    expect(() => tagsFor("refs/heads/main", "1.0\\")).toThrow(/plain version token/);
  });

  it("no non-tag ref can reach :latest", () => {
    // The property, stated once over every non-release path this workflow can be entered by.
    for (const ref of [
      "refs/heads/main",
      "refs/heads/claude/some-branch",
      "refs/heads/release/v2",
    ]) {
      expect(claimsLatest(tagsFor(ref)), `${ref} claimed :latest`).toBe(false);
    }
    expect(claimsLatest(tagsFor("refs/heads/main", "", "workflow_run"))).toBe(false);
  });

  it("pastes no workflow input or event payload into the script", () => {
    // A `${{ inputs.version }}` inside `run:` is substituted into the shell source before bash
    // sees it, so a dispatch with `version: $(…)` would execute. They arrive through `env:`.
    const workflow = load(readFileSync(WORKFLOW, "utf8")) as Workflow;
    const step = workflow.jobs.deploy.steps?.find((s) => s.id === "vars");

    expect(step?.run).toBeDefined();
    expect(step?.run).not.toMatch(/\$\{\{[^}]*(inputs\.|github\.event\.)/);
  });
});
