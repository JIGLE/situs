import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A standing guard, not a unit test — sibling to error-status-consistency.test.ts.
 *
 * `createErrorResponse` already does the right thing: a plain `Error` answers with the static
 * "Internal server error" and the real text goes to the log. The leaks were all in routes that
 * BYPASS it and hand-roll `NextResponse.json({ error: err.message })`, where the message reaching
 * the client is whatever the failure happened to say — Prisma column names, file paths, Stripe
 * request ids, SendGrid key prefixes.
 *
 * Fifteen sites were flagged in the V1 audit. Two of them (`/api/health/db`, `/api/health/email`)
 * have neither auth nor an env gate, so their bodies were readable by anyone who could reach the
 * port.
 *
 * This scans for the pattern rather than testing one route, because the fix is only durable if
 * reintroducing it anywhere under app/api fails the suite. Allowed forms:
 *
 *   - the message is gated on NODE_ENV, the pattern /api/monitoring/health established: detailed
 *     in development where it is the point, generic in production
 *   - the file is a debug route, which is already gated behind NODE_ENV as a whole
 *   - the value is being LOGGED rather than returned — console.error/logger calls are the
 *     intended destination for the real text and must not be discouraged
 *   - the message is returned under an explicit application error-code check
 *     (`if (e.code === "FILE_TOO_LARGE") return ... e.message`). Those messages are written by
 *     this codebase FOR the user and answer a real status (413/415/404); suppressing them would
 *     replace "File is too large" with "Failed to upload", which is a downgrade, not a fix.
 *     The risk being guarded is ARBITRARY exception text reaching a user, not deliberate text.
 */

const API_DIR = join(process.cwd(), "app", "api");

/**
 * Every `.message` read. Deliberately trivial.
 *
 * The first version of this matched the whole shape in one pattern —
 * `(?:error|message)\s*:\s*(?:\w+\s+instanceof\s+Error\s*\?\s*)?\w+\.message` — and ESLint's
 * `security/detect-unsafe-regex` rejected it as a backtracking hazard. It was right: the
 * optional group ending in `\w+` sits directly before another `\w+`, which is the classic
 * ambiguity. `error-status-consistency.test.ts` hit the same wall and solved it the same way —
 * match something unambiguous, then decide by walking the surrounding text.
 */
const MESSAGE_READ = /\.message\b/g;

/** How far back to look for the key that would put this read into a response body. */
const KEY_WINDOW = 90;

/**
 * True when the `.message` at `index` is being assigned to an `error:` or `message:` key — i.e.
 * it is on its way into a response body rather than into a log argument or a comparison.
 */
function isBodyValue(src: string, index: number): boolean {
  const window = src.slice(Math.max(0, index - KEY_WINDOW), index);
  const key = Math.max(window.lastIndexOf("error:"), window.lastIndexOf("message:"));
  if (key === -1) return false;

  // `catch (error: unknown)` is a TYPE ANNOTATION, not an object key. Without this the three
  // payment webhooks looked like leaks when they are already correct — they assign the text to
  // a local, log it, and answer a static "Internal error". Flagging correct code is how a
  // guard like this gets muted wholesale.
  if (/catch\s*\($/.test(window.slice(Math.max(0, key - 10), key))) return false;

  // Nothing between the key and the read may close the property — if it does, the key belonged
  // to an earlier entry and this read is somewhere else entirely.
  return !/[;}]/.test(window.slice(key));
}

/** Debug routes are gated behind NODE_ENV wholesale; their bodies are a development affordance. */
const EXEMPT_PREFIXES = ["debug/"];

/**
 * True when the whole route refuses to serve outside development, e.g.
 * `if (process.env.NODE_ENV !== "development") return ... 403`.
 *
 * This is a FILE-level property, which is why isProductionGated's backward window cannot see
 * it — the gate sits at the top of the handler, hundreds of characters above the body being
 * built. `/api/monitoring/errors` is the case: it exists to dump recent errors to a developer
 * and is unreachable in production, so its detail is the entire point.
 */
function isDevelopmentOnlyRoute(src: string): boolean {
  return /NODE_ENV\s*!==\s*["']development["']/.test(src);
}

function routeFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
}

/**
 * True when the match sits inside a NODE_ENV-gated expression. Checked over a window before the
 * match rather than by parsing: the guard is written as a ternary whose condition is a few lines
 * up, and a window is enough to tell "production stripped" from "returned raw".
 */
function isProductionGated(src: string, index: number): boolean {
  const window = src.slice(Math.max(0, index - 400), index);
  return /NODE_ENV\s*===\s*["']production["']|isProduction/.test(window);
}

/**
 * True when the read is an argument to a logger call, not part of a response.
 *
 * The statement boundary matters and was got wrong first time: a plain 200-character lookback
 * matched the `console.error(...)` on the PRECEDING line and excused the leak on the line after
 * it — which is the exact shape of every route fixed here (log it, then return). That is a
 * FALSE NEGATIVE, the direction that makes a guard worthless, and it was caught only by
 * re-running the revert proof after adding the exemptions.
 *
 * So: the logger call must still be open when the read happens — no `;` between them.
 *
 * `log.` is here because `const log = logger.child({ component })` is this repo's idiom, used
 * in four lib services. No route had used it before, and `app/api/` is the only tree this scans,
 * so the alias had simply never been met — the first route to use it was reported as a leak
 * while returning a static body. Note the direction: an unrecognised logger over-reports, it
 * cannot hide a leak, which is why this was safe to widen. `\b` keeps it from matching
 * `catalog.error(...)` and friends.
 */
function isLogCall(src: string, index: number): boolean {
  const window = src.slice(Math.max(0, index - 200), index);
  const call = window.search(
    /console\.(error|warn|log)\s*\(|\blogger\.\w+\s*\(|\bLogger\.\w+\s*\(|\blog\.\w+\s*\(/,
  );
  if (call === -1) return false;
  return !window.slice(call).includes(";");
}

/**
 * True when the return is guarded by an application error-code check on the same statement.
 * The window is deliberately tight — these are single-line guards — so it cannot reach back
 * over an earlier `if` and exempt an unrelated generic return.
 */
function isAppCodedError(src: string, index: number): boolean {
  const window = src.slice(Math.max(0, index - 130), index);
  return /\.code\s*===\s*["'][A-Z_]+["']/.test(window);
}

/**
 * True when the read is a Zod issue message, as in
 * `` new Error(`Validation error: ${error.issues.map((e) => e.message).join(", ")}`) ``.
 *
 * Same category as the app-coded errors: these strings are written in this repo's own schemas
 * ("Property name is required") specifically to be shown. They surfaced here only because the
 * literal prefix "Validation error:" contains the substring `error:` that isBodyValue looks
 * for — a false positive from not tracking string context, which is not worth parsing for.
 */
function isZodIssue(src: string, index: number): boolean {
  return src.slice(Math.max(0, index - 60), index).includes(".issues.map(");
}

function collectLeaks(): string[] {
  const leaks: string[] = [];
  for (const relative of routeFiles()) {
    if (EXEMPT_PREFIXES.some((p) => relative.startsWith(p))) continue;
    const src = readFileSync(join(API_DIR, relative), "utf8");
    if (isDevelopmentOnlyRoute(src)) continue;

    for (const match of src.matchAll(MESSAGE_READ)) {
      if (!isBodyValue(src, match.index)) continue;
      if (isProductionGated(src, match.index)) continue;
      if (isLogCall(src, match.index)) continue;
      if (isAppCodedError(src, match.index)) continue;
      if (isZodIssue(src, match.index)) continue;
      const line = src.slice(0, match.index).split("\n").length;
      const statement = src.slice(Math.max(0, match.index - KEY_WINDOW), match.index + 8).trim();
      leaks.push(`app/api/${relative}:${line} — ...${statement}`);
    }
  }
  return leaks;
}

describe("app/api error message leakage", () => {
  it("finds route files to scan (guards against the walk silently matching nothing)", () => {
    // Without this the whole file is a no-op the moment the directory layout moves — the exact
    // green-but-inert shape this repo keeps producing.
    expect(routeFiles().length).toBeGreaterThan(50);
  });

  it("detects the pattern it is meant to detect", () => {
    // Proves the regex is live. If MESSAGE_IN_BODY stops matching the shape it was written for,
    // collectLeaks() returns [] forever and the guard below passes without guarding anything.
    const sample = `return NextResponse.json({ error: error instanceof Error ? error.message : "x" });`;
    const hits = [...sample.matchAll(MESSAGE_READ)].filter((m) => isBodyValue(sample, m.index));
    expect(hits).toHaveLength(1);

    // And the converse: a log call reads .message too, but not into a body.
    const logged = `console.error("boom:", error instanceof Error ? error.message : error);`;
    expect([...logged.matchAll(MESSAGE_READ)].filter((m) => isBodyValue(logged, m.index))).toEqual(
      [],
    );
  });

  it("exempts app-coded messages but not the generic return beside them", () => {
    // The exemptions are the part most likely to rot into a blanket pass. This pins both sides:
    // the coded guard is allowed, and an unguarded return two lines later still trips.
    const coded = `if (e.code === "FILE_TOO_LARGE") return NextResponse.json({ error: e.message }, { status: 413 });`;
    const bare = `return NextResponse.json({ error: e.message }, { status: 500 });`;
    const codedIdx = [...coded.matchAll(MESSAGE_READ)][0].index;
    const bareIdx = [...bare.matchAll(MESSAGE_READ)][0].index;

    expect(isAppCodedError(coded, codedIdx)).toBe(true);
    expect(isAppCodedError(bare, bareIdx)).toBe(false);
  });

  it("does not let a preceding log call excuse the return after it", () => {
    // The regression this pins actually happened. Every route fixed here has the shape
    // "log the error, then return" — and a naive lookback found the console.error on the
    // previous line and exempted the leak on the next one. A false negative in a leak guard
    // is indistinguishable from having no guard, and it survived until the revert proof was
    // re-run after the exemptions went in.
    const logThenLeak = [
      `console.error("Billing checkout error:", error);`,
      `return NextResponse.json({ error: error instanceof Error ? error.message : "x" });`,
    ].join("\n    ");
    const idx = [...logThenLeak.matchAll(MESSAGE_READ)].at(-1)!.index;

    expect(isLogCall(logThenLeak, idx)).toBe(false);
    expect(isBodyValue(logThenLeak, idx)).toBe(true);
  });

  it("never returns a raw error message in a response body", () => {
    const leaks = collectLeaks();

    expect(
      leaks,
      `A caught error's text is written for a developer, not a landlord — it carries Prisma\n` +
        `column names, file paths and third-party request ids. Log it and return a static\n` +
        `message, or gate the detailed form on NODE_ENV the way /api/monitoring/health does.\n` +
        `Routes using createErrorResponse already get this for free.\n\n` +
        leaks.join("\n"),
    ).toEqual([]);
  });
});
