import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A standing guard, not a unit test.
 *
 * `createErrorResponse` resolves the HTTP status from the error TYPE and ignores the status
 * argument when the two disagree (see lib/utils/error-handling.ts). That makes
 * `createErrorResponse(new ValidationError("Tenant not found"), 404, request)` read as a 404 to
 * anyone skimming it while actually answering 400.
 *
 * Seventeen call sites drifted that way before anyone noticed, because the mismatch is invisible
 * at the call site and no test asserted a status that a route only *intended*. The most visible
 * casualty was the tenant portal: its client branches on `status === 401 || status === 404` to
 * show "this link is invalid or has expired", so an expired link produced a generic
 * "couldn't load" instead.
 *
 * This scans the route handlers rather than any single behaviour, so reintroducing the pattern
 * anywhere under app/api fails the suite instead of shipping.
 */

// Status each error subclass forces, regardless of what the caller passes.
const FORCED_STATUS: Record<string, number> = {
  ValidationError: 400,
  AuthenticationError: 401,
  AuthorizationError: 403,
  ResourceNotFoundError: 404,
  ForbiddenError: 403,
  DatabaseError: 500,
};

// Opening of the call, up to the `(` that starts the constructor arguments. Deliberately simple:
// a regex that also spanned the arguments needed nested quantifiers, which is a backtracking
// hazard. The closing paren is found by walking instead.
const CALL_OPENING = /createErrorResponse\(\s*new\s+(\w+)\s*\(/g;

// An explicit status immediately after the constructor's closing paren. No status means the
// caller took the default, which cannot conflict with anything.
const TRAILING_STATUS = /^\s*,\s*(\d{3})/;

// Vitest runs with the repo root as cwd.
const API_DIR = join(process.cwd(), "app", "api");

function routeFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
}

/** Index just past the `)` matching an already-consumed `(`, or -1 if unbalanced. */
function endOfArguments(src: string, start: number): number {
  let depth = 1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

function collectMismatches() {
  const mismatches: string[] = [];
  for (const relative of routeFiles()) {
    const src = readFileSync(join(API_DIR, relative), "utf8");
    for (const match of src.matchAll(CALL_OPENING)) {
      const errorType = match[1];
      const forced = FORCED_STATUS[errorType];
      if (forced === undefined) continue;

      const argsEnd = endOfArguments(src, match.index + match[0].length);
      if (argsEnd === -1) continue;

      const status = TRAILING_STATUS.exec(src.slice(argsEnd, argsEnd + 16));
      if (!status || Number(status[1]) === forced) continue;

      const line = src.slice(0, match.index).split("\n").length;
      mismatches.push(
        `app/api/${relative}:${line} — ${errorType} passes ${status[1]} but answers ${forced}`,
      );
    }
  }
  return mismatches;
}

describe("app/api error status consistency", () => {
  it("finds route files to scan (guards against the walk silently matching nothing)", () => {
    expect(routeFiles().length).toBeGreaterThan(50);
  });

  it("never passes a status that the error type will discard", () => {
    const mismatches = collectMismatches();

    expect(
      mismatches,
      `The status argument is ignored when it conflicts with the error type.\n` +
        `Use the type that resolves to the status you want — ResourceNotFoundError for 404,\n` +
        `AuthorizationError/ForbiddenError for 403.\n` +
        `A plain Error honours the status but replaces the message with "Internal server error".\n\n` +
        mismatches.join("\n"),
    ).toEqual([]);
  });
});
