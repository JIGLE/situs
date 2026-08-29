import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * A caught error's `.message` must never reach the screen.
 *
 * Everything an API route sends comes through `createErrorResponse`, which writes English into
 * the envelope's `error` field; `apiFetch` wraps that string in an `Error`. Roughly thirty
 * components then rendered `err.message` into a banner or a toast, so a Portuguese user met
 * "Failed to load bank movements" the moment anything went wrong — at the point they were least
 * able to guess what it meant.
 *
 * The English fallback beside it was the same leak wearing a different hat:
 * `err instanceof Error ? err.message : "Failed to save"` is English either way.
 *
 * This is a static contract rather than another unit test because that is what the shape of the
 * defect demands. It was never one mistake in one place — it was the obvious thing to write,
 * written thirty times over several years by people each solving a local problem. A unit test
 * per site would be thirty tests that pass while the thirty-first is being typed.
 *
 * `lib/utils/api-error.ts` is the replacement: it maps the HTTP status `apiFetch` already
 * attaches onto a sentence the catalogue owns.
 */
const ROOT = join(import.meta.dirname, "..");

/**
 * Only where a human reads the result. `app/api/**` and the services behind it log for an
 * operator reading a container's stderr, and an English log line is correct there — translating
 * it would make the app harder to support, not easier to use.
 */
const SEARCH_ROOTS = [
  "components",
  "lib/contexts",
  "lib/hooks",
  "app/[locale]",
  "app/tenant-portal",
];

/** Assignments that put a value in front of a person. */
const DISPLAY_SINKS = /\b(setError|showError|toast\.(error|warning)|setPaymentMsg|error)\s*\(/;

function sourceFiles(): string[] {
  const globs = SEARCH_ROOTS.map((r) => `'${r}'`).join(" ");
  const out = execSync(
    `grep -rl --include='*.ts' --include='*.tsx' 'instanceof Error' ${globs} 2>/dev/null || true`,
    { cwd: ROOT, encoding: "utf8", shell: "/bin/bash" },
  ).trim();
  return out ? out.split("\n").filter((f) => !f.includes(".test.")) : [];
}

describe("no server error text reaches the user", () => {
  it("still has files to check", () => {
    // If this ever returns nothing, the grep broke rather than the tree becoming perfect —
    // `instanceof Error` is load-bearing in plenty of places that are entirely fine.
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it("never renders a caught error's .message", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        // `x instanceof Error ? x.message` — the ternary that reads the server's sentence, and
        // its English fallback, in one idiom.
        if (!/instanceof Error\s*\?\s*\w+\.message/.test(line)) return;

        // Its sink may be on this line or the line that opened the statement, since prettier
        // wraps a long ternary onto its own line.
        const context = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join("\n");
        if (!DISPLAY_SINKS.test(context)) return;

        offenders.push(
          `${file}:${i + 1} — renders a caught error's message; use useApiError() instead`,
        );
      });
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
