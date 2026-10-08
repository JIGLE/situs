// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classify } from "../scripts/audit-gate";

/**
 * The dependency audit gate decides what `npm audit` may block: a package the app ships fails the
 * build on a critical or high advisory; a package only the tooling uses fails it on a critical one
 * and warns on a high one. It exists because a development-only high advisory (`braces`, with no
 * patched release) kept the old gate red for days, and six advisories on `next` itself arrived
 * behind that red unnoticed.
 *
 * "Production" is a fact the audit states (`npm audit --omit=dev`), not a list of package names, so
 * nothing here can go stale. The cases below are the three ways such a gate is wrong: it lets a
 * production advisory through, it blocks on tooling it should only mention, or it reads a missing
 * report as a clean one.
 */

type Severity = "critical" | "high" | "moderate" | "low";

/** The part of `npm audit --json` the gate reads. `through` names a package this one is vulnerable by way of. */
function audit(vulns: Record<string, { severity: Severity; through?: string }> = {}) {
  const vulnerabilities = Object.fromEntries(
    Object.entries(vulns).map(([pkg, { severity, through }]) => [
      pkg,
      {
        name: pkg,
        severity,
        via: through
          ? [through]
          : [
              {
                title: `Advisory in ${pkg}`,
                url: `https://github.com/advisories/${pkg}`,
                severity,
              },
            ],
      },
    ]),
  );
  return { vulnerabilities, metadata: { vulnerabilities: { total: Object.keys(vulns).length } } };
}

describe("classify", () => {
  it("has nothing to say about a tree with no advisories", () => {
    expect(classify(audit(), audit())).toEqual({ blocking: [], warnings: [], notes: [] });
  });

  it.each(["critical", "high"] as const)(
    "blocks on a %s advisory in a package the app ships",
    (severity) => {
      const prod = audit({ next: { severity } });
      const { blocking, warnings } = classify(prod, prod);
      expect(blocking.map((entry) => entry.pkg)).toEqual(["next"]);
      expect(blocking[0]).toMatchObject({ scope: "production", severity });
      expect(warnings).toEqual([]);
    },
  );

  it("only notes a moderate or low advisory in a package the app ships", () => {
    const prod = audit({ a: { severity: "moderate" }, b: { severity: "low" } });
    const { blocking, notes } = classify(prod, prod);
    expect(blocking).toEqual([]);
    expect(notes.map((entry) => entry.pkg).sort()).toEqual(["a", "b"]);
  });

  it("warns on a high advisory only the tooling reaches, and does not block", () => {
    // The braces case: in the full audit, absent from the production one.
    const all = audit({
      braces: { severity: "high" },
      micromatch: { severity: "high", through: "braces" },
    });
    const { blocking, warnings } = classify(audit(), all);
    expect(blocking).toEqual([]);
    expect(warnings.map((entry) => entry.pkg).sort()).toEqual(["braces", "micromatch"]);
    expect(warnings.every((entry) => entry.scope === "development")).toBe(true);
  });

  it("still blocks on a critical advisory only the tooling reaches", () => {
    const { blocking, warnings } = classify(audit(), audit({ runner: { severity: "critical" } }));
    expect(blocking.map((entry) => entry.pkg)).toEqual(["runner"]);
    expect(blocking[0].scope).toBe("development");
    expect(warnings).toEqual([]);
  });

  it("treats a package in both audits as production, so its high advisory blocks", () => {
    const both = audit({ shared: { severity: "high" } });
    const { blocking, warnings } = classify(both, both);
    expect(blocking.map((entry) => entry.pkg)).toEqual(["shared"]);
    expect(warnings).toEqual([]);
  });

  it("separates the two scopes when both have findings", () => {
    const prod = audit({ next: { severity: "high" } });
    const all = audit({ next: { severity: "high" }, braces: { severity: "high" } });
    const { blocking, warnings } = classify(prod, all);
    expect(blocking.map((entry) => entry.pkg)).toEqual(["next"]);
    expect(warnings.map((entry) => entry.pkg)).toEqual(["braces"]);
  });

  it("judges a package in both audits on the worse of the two readings", () => {
    // The audits run seconds apart; a new advisory can land between them.
    const { blocking } = classify(
      audit({ x: { severity: "low" } }),
      audit({ x: { severity: "critical" } }),
    );
    expect(blocking).toMatchObject([{ pkg: "x", severity: "critical", scope: "production" }]);
  });

  it("does not let the full audit's milder reading excuse a production advisory", () => {
    const { blocking } = classify(
      audit({ x: { severity: "high" } }),
      audit({ x: { severity: "low" } }),
    );
    expect(blocking.map((entry) => entry.pkg)).toEqual(["x"]);
  });

  it.each(["HIGH", "urgent", undefined])(
    "blocks, rather than pass, on a severity it does not recognise (%s) in either scope",
    (severity) => {
      const odd = audit({ x: { severity: severity as never } });
      expect(classify(odd, odd).blocking.map((entry) => entry.pkg)).toEqual(["x"]);
      expect(classify(audit(), odd).blocking.map((entry) => entry.pkg)).toEqual(["x"]);
    },
  );

  it("names the most severe advisory when a package has several", () => {
    const prod = audit();
    prod.vulnerabilities.next = {
      name: "next",
      severity: "high",
      via: [
        { title: "Draft Mode leak", url: "https://example.org/a", severity: "moderate" },
        { title: "SSRF in Image Optimization", url: "https://example.org/b", severity: "high" },
        { title: "Dev server MCP endpoint", url: "https://example.org/c", severity: "low" },
      ],
    } as never;
    const { blocking } = classify(prod, prod);
    expect(blocking[0]).toMatchObject({
      title: "SSRF in Image Optimization",
      url: "https://example.org/b",
    });
  });

  it("names the package a chained advisory comes through", () => {
    const { warnings } = classify(
      audit(),
      audit({ micromatch: { severity: "high", through: "braces" } }),
    );
    expect(warnings[0].title).toBe("through braces");
  });

  it("says why when npm's own audit failed, instead of a vague complaint about the shape", () => {
    const failed = { error: { code: "ENOAUDIT", summary: "registry unreachable" } };
    expect(() => classify(failed as never, audit())).toThrow(/registry unreachable/);
  });

  it.each([
    ["null", null],
    ["a string", "{}"],
    ["npm's error document", { error: { code: "ENOAUDIT", summary: "registry unreachable" } }],
    ["no vulnerabilities object", { metadata: { vulnerabilities: {} } }],
    ["no counts", { vulnerabilities: {} }],
  ])("refuses a report that is %s, in either position", (_name, broken) => {
    expect(() => classify(broken as never, audit())).toThrow();
    expect(() => classify(audit(), broken as never)).toThrow();
  });
});

describe("the command", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  /** Run the script on report files, as the workflow does. Returns its exit status and output. */
  function run(prod: unknown, all: unknown, only?: "prod" | "all") {
    const dir = mkdtempSync(path.join(tmpdir(), "audit-gate-"));
    dirs.push(dir);
    const files = { prod: path.join(dir, "prod.json"), all: path.join(dir, "all.json") };
    const write = (file: string, content: unknown) =>
      writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    if (prod !== undefined) write(files.prod, prod);
    if (all !== undefined) write(files.all, all);
    const args =
      only === "prod"
        ? ["--prod", files.prod]
        : only === "all"
          ? ["--all", files.all]
          : ["--prod", files.prod, "--all", files.all];
    try {
      const out = execFileSync("node", ["scripts/audit-gate.js", ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      });
      return { status: 0, out };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { status: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  }

  it("passes, with a warning, when only the tooling has a high advisory", () => {
    const { status, out } = run(audit(), audit({ braces: { severity: "high" } }));
    expect(status).toBe(0);
    expect(out).toContain("::warning::braces (high, development)");
  });

  it("fails when a package the app ships has a high advisory", () => {
    const prod = audit({ next: { severity: "high" } });
    const { status, out } = run(prod, prod);
    expect(status).toBe(1);
    expect(out).toContain("::error::next (high, production)");
  });

  it("fails when the tooling has a critical advisory", () => {
    expect(run(audit(), audit({ runner: { severity: "critical" } })).status).toBe(1);
  });

  it("fails, rather than pass, when a report is missing", () => {
    expect(run(audit(), undefined).status).toBe(1);
    expect(run(undefined, audit()).status).toBe(1);
  });

  it("fails on a report that is not JSON", () => {
    expect(run("{not json", audit()).status).toBe(1);
  });

  it("fails when given only one of the two reports", () => {
    expect(run(audit(), audit(), "prod").status).toBe(1);
    expect(run(audit(), audit(), "all").status).toBe(1);
  });
});
