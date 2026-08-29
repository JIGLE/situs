import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * `apiFetch` unwraps the envelope. Reading `.data` off its result unwraps it twice.
 *
 * Every route replies through `createSuccessResponse(x)`, which sends `{ data: x }`, and
 * `apiFetch` returns `body.data` when the response carries one. So the value a caller receives
 * is already `x` — and `result.data` is `undefined`.
 *
 * Three call sites had made this mistake, and none of them failed a build, because each declared
 * the pre-unwrap shape as its type argument: `apiFetch<{ data: Document }>` asserts a shape
 * rather than producing one, so the compiler agreed with a claim the runtime had already made
 * false. The cost was invisible in review and total at runtime:
 *
 *   - `document-detail-panel` rendered "Document not found" for every document that exists;
 *   - `bank-connect-panel`'s institution list came back empty, so the bank picker offered
 *     nothing to connect to;
 *   - `bank-connect-panel`'s connect button read `body.data.url`, got `undefined`, and failed
 *     on every attempt — a step the empty picker meant nobody could even reach.
 *
 * Two of those were in one file, which is what makes this a class rather than three mistakes: a
 * reviewer who fixes the one they were shown does not go looking for the one above it. So this
 * is a static contract over the tree rather than another unit test.
 *
 * Reading `.data` defensively is fine and stays legal — `res.data ?? res` and
 * `Array.isArray(res) ? res : res.data` both produce the right value whichever shape arrives.
 * What this rejects is an UNGUARDED read, which is only ever the double unwrap.
 */
const ROOT = join(import.meta.dirname, "..");

/** Source files that call `apiFetch`, from git rather than a hand-kept list. */
function callSites(): string[] {
  const out = execSync(
    "grep -rl 'apiFetch' components app lib --include=*.ts --include=*.tsx || true",
    { cwd: ROOT, encoding: "utf8" },
  ).trim();
  return out ? out.split("\n") : [];
}

/** `x.data ?? x`, `x.data || x`, `Array.isArray(x) ? x : x.data` — all safe either way. */
function isGuarded(snippet: string, receiver: string): boolean {
  const r = receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`${r}\\s*(?:as [^)]*\\))?\\s*\\??\\.\\s*data\\s*(\\?\\?|\\|\\|)`).test(snippet) ||
    new RegExp(`Array\\.isArray\\(\\s*${r}\\s*\\)`).test(snippet) ||
    new RegExp(`\\)\\s*\\.\\s*data\\s*\\?\\?\\s*${r}`).test(snippet)
  );
}

describe("apiFetch callers do not unwrap the envelope twice", () => {
  it("has call sites to check", () => {
    expect(callSites().length).toBeGreaterThan(0);
  });

  it("never reads .data off an apiFetch result without a fallback", () => {
    const offenders: string[] = [];

    // Both shapes a result can arrive in. The `.then` form is not hypothetical — the document
    // detail panel used it, and a guard that only understood `await` would have called that
    // file clean while it rendered "Document not found" for every document in the archive.
    const receivers = [
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+apiFetch\b/g,
      /apiFetch\b[\s\S]{0,400}?\)\s*\r?\n?\s*\.then\(\s*\(?\s*([A-Za-z_$][\w$]*)/g,
    ];

    for (const file of callSites()) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const pattern of receivers) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(source))) {
          const receiver = match[1];
          // Look only at the statements that follow, up to the end of the enclosing block-ish
          // region — far enough to catch the read, near enough not to collide with another call.
          const window = source.slice(match.index, match.index + 900);
          const reads = new RegExp(`\\b${receiver}\\s*\\??\\.\\s*data\\b`).test(window);
          if (reads && !isGuarded(window, receiver)) {
            const line = source.slice(0, match.index).split("\n").length;
            const entry = `${file}:${line} — \`${receiver}.data\` after apiFetch already unwrapped`;
            if (!offenders.includes(entry)) offenders.push(entry);
          }
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
