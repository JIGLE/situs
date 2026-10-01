import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A standing guard, not a unit test.
 *
 * `request.json()` rejects a body that is empty or malformed with a `SyntaxError`, and
 * `withErrorHandler` answers an error it does not know as a 500. So a client that sent something
 * that is not JSON got "Internal server error", and every such request counted as a server fault.
 * The fix was made route by route, six times, each with the same comment, before a route audit
 * found the same read still bare on about twenty-five others.
 *
 * `readJson` (lib/utils/error-handling.ts) turns that `SyntaxError` into a `ValidationError`, which
 * answers 400. This scans the route handlers, so a bare read anywhere under app/api fails the suite
 * instead of shipping.
 *
 * JSON that is not an object is the caller's mistake too. `null` is the one that hurts: a handler
 * that reads `raw.tenantId` off it throws a `TypeError`, which answers 500. `readJsonObject` refuses
 * it with a 400, so a route that reads fields off the body takes it from there, and this refuses the
 * older way, a `readJson` result cast to `RawBody`.
 *
 * A handler that answers its own errors rather than through `withErrorHandler` has to catch the
 * `ValidationError` itself, and nothing static can tell that it does:
 * json-body-answers-400.test.ts exercises the ones that exist.
 */

// Vitest runs with the repo root as cwd.
const API_DIR = join(process.cwd(), "app", "api");

function routeFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
}

/** Blank out comments, keeping every newline, so a line number still points at the real line. */
function withoutComments(src: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_all, lead: string, comment: string) => lead + blank(comment));
}

// The call itself, then a look at what it is called on. One regex that also spanned the receiver
// and an optional `.clone()` needed nested quantifiers, which is a backtracking hazard.
const JSON_CALL = /\.\s*json\s*\(/g;
// A request-like name, so `res.json()` on an outbound fetch is not a body read: `request`, `req`,
// `nextRequest`, `httpReq`.
const REQUEST_NAME = /(?:^|[^\w$])[\w$]*[Rr]eq(?:uest)?$/;

/** The line of every `.json()` called on something named like a request, optionally cloned. */
function bareReads(src: string): number[] {
  const code = withoutComments(src);
  const lines: number[] = [];
  for (const call of code.matchAll(JSON_CALL)) {
    const receiver = code
      .slice(Math.max(0, call.index - 80), call.index)
      .trimEnd()
      .replace(/\.\s*clone\s*\(\s*\)$/, "")
      .trimEnd();
    if (REQUEST_NAME.test(receiver)) lines.push(code.slice(0, call.index).split("\n").length);
  }
  return lines;
}

// A `readJson` result cast to `RawBody`. `[^()]*` is the argument, which has no parentheses of its
// own here; keeping the pattern flat avoids the nested quantifiers of a backtracking hazard.
const RAW_CAST = /\breadJson\s*\([^()]*\)\s*\)?\s*as\s+RawBody\b/g;

/** The line of every `readJson(...)` result cast to `RawBody`. */
function rawCasts(src: string): number[] {
  const code = withoutComments(src);
  return [...code.matchAll(RAW_CAST)].map((m) => code.slice(0, m.index).split("\n").length);
}

describe("app/api reads its JSON bodies through readJson", () => {
  it("finds route files to scan (guards against the walk silently matching nothing)", () => {
    expect(routeFiles().length).toBeGreaterThan(50);
  });

  it("recognises every way a route can read the body bare", () => {
    const reads: [string, number[]][] = [
      ["const body = await request.json();", [1]],
      ["const body = (await request.json()) as Body;", [1]],
      ["parseBody(await req.json(), schema)", [1]],
      ["const copy = await request.clone().json();", [1]],
      ["await nextRequest\n  .json()", [2]],
      ["const a = 1;\nconst body = await request.json().catch(() => ({}));", [2]],
    ];
    for (const [src, lines] of reads) expect(bareReads(src), src).toEqual(lines);
  });

  it("leaves alone what is not a request's body", () => {
    const fine = [
      "const body = await readJson(request);",
      "return NextResponse.json({ error }, { status: 400 });",
      "const data = await response.json();",
      "const data = await res.json();",
      "// the old way was await request.json();",
      "/* await request.json() */",
      "const url = 'http://x'; // request.json()",
    ];
    for (const src of fine) expect(bareReads(src), src).toEqual([]);
  });

  it("never calls request.json() bare: a body that is not JSON must answer 400, not 500", () => {
    const offenders: string[] = [];
    for (const relative of routeFiles()) {
      const src = readFileSync(join(API_DIR, relative), "utf8");
      for (const line of bareReads(src)) offenders.push(`app/api/${relative}:${line}`);
    }

    expect(
      offenders,
      `request.json() rejects a body that is not JSON with a SyntaxError, which withErrorHandler\n` +
        `answers as a 500. Read it with readJson(request), or parseJsonBody(request, schema), from\n` +
        `@/lib/utils/error-handling: both answer a ValidationError, which is a 400.\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("recognises a readJson result cast to RawBody", () => {
    const casts: [string, number[]][] = [
      ["const raw = (await readJson(request)) as RawBody;", [1]],
      ["const raw = await readJson(request) as RawBody;", [1]],
      ["const a = 1;\nconst raw = (await readJson(\n  request,\n)) as RawBody;", [2]],
    ];
    for (const [src, lines] of casts) expect(rawCasts(src), src).toEqual(lines);

    const fine = [
      "const raw = await readJsonObject(request);",
      "const body = (await readJson(request)) as Body;",
      "const raw = await readJson(request);",
      "// was (await readJson(request)) as RawBody;",
    ];
    for (const src of fine) expect(rawCasts(src), src).toEqual([]);
  });

  it("never casts a readJson result to RawBody: JSON null must answer 400, not 500", () => {
    const offenders: string[] = [];
    for (const relative of routeFiles()) {
      const src = readFileSync(join(API_DIR, relative), "utf8");
      for (const line of rawCasts(src)) offenders.push(`app/api/${relative}:${line}`);
    }

    expect(
      offenders,
      `A body of JSON null, an array, a string or a number passes readJson, and a handler that reads\n` +
        `raw.field off it throws a TypeError, which answers 500. Read it with readJsonObject(request)\n` +
        `from @/lib/utils/error-handling: it refuses what is not an object with a 400.\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
