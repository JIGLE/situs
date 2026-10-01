import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A standing guard, not a unit test.
 *
 * `proxy.ts` leaves `/api/auth/**` alone: no session check, no CSRF check. The prefix is NextAuth's,
 * and the TOTP routes were put under it too, where `requireAuth` authenticates them and nothing
 * else protects them. `GET /api/auth/totp/setup` even wrote `totpEnabled: false`, so a link
 * followed while signed in switched the second factor off. A prefix the proxy exempts exempts every
 * route ever added under it, so a handler here that changes state checks the token itself, with
 * `csrfProtection` (lib/middleware/csrf.ts), or is named below with the reason it need not.
 *
 * This reads each handler's own source: a call in a comment, or in the handler next door, does not
 * count. A state change as a GET is outside what it can see; `management.test.ts` asserts that
 * `setup` exports none.
 */

// Vitest runs with the repo root as cwd.
const AUTH_DIR = join(process.cwd(), "app", "api", "auth");

/** Routes under /api/auth that change state without calling `csrfProtection`, and why. */
const EXEMPT: Record<string, string> = {
  "[...nextauth]/route.ts": "NextAuth checks its own csrfToken on sign-in and sign-out.",
  "totp/verify/route.ts":
    "A session that has passed only its first factor has to be able to send its code, and need not " +
    "hold a CSRF cookie: the proxy seeds it for portal pages, which that session is kept out of. " +
    "The route answers only a correct code, and is rate limited per account.",
};

const STATE_CHANGING = "POST|PUT|PATCH|DELETE";
const HANDLER_EXPORT = new RegExp(
  `^export\\s+(?:(?:async\\s+)?function\\s+|const\\s+)(${STATE_CHANGING})\\b|^export\\s*\\{[^}]*\\bas\\s+(${STATE_CHANGING})\\b`,
);
const CSRF_CALL = /\b(?:csrfProtection|withCsrfProtection)\s*\(/;

/** Blank out comments, keeping every newline, so a line number still points at the real line. */
function withoutComments(src: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_all, lead: string, comment: string) => lead + blank(comment));
}

/** `line METHOD` of every state-changing handler in `src` that does not call `csrfProtection`. */
function unchecked(src: string): string[] {
  const code = withoutComments(src);
  const starts = [...code.matchAll(/^export\s/gm)].map((m) => m.index);
  const found: string[] = [];
  starts.forEach((start, i) => {
    const segment = code.slice(start, starts[i + 1] ?? code.length);
    const handler = HANDLER_EXPORT.exec(segment);
    if (handler && !CSRF_CALL.test(segment)) {
      const line = code.slice(0, start).split("\n").length;
      found.push(`${line} ${handler[1] ?? handler[2]}`);
    }
  });
  return found;
}

function routeFiles(): string[] {
  return readdirSync(AUTH_DIR, { recursive: true, encoding: "utf8" })
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f.endsWith("route.ts"));
}

describe("a state-changing /api/auth handler checks the CSRF token itself", () => {
  it("finds the routes to scan (guards against the walk silently matching nothing)", () => {
    const files = routeFiles();
    expect(files).toContain("totp/setup/route.ts");
    expect(files).toContain("totp/enable/route.ts");
    expect(files).toContain("totp/disable/route.ts");
  });

  it("names only routes that exist, so a renamed route does not leave its exemption behind", () => {
    for (const file of Object.keys(EXEMPT)) {
      expect(existsSync(join(AUTH_DIR, file)), `${file} is exempt but is not a route`).toBe(true);
    }
  });

  it("has no state-changing handler without the check", () => {
    const missing = routeFiles()
      .filter((file) => !(file in EXEMPT))
      .flatMap((file) =>
        unchecked(readFileSync(join(AUTH_DIR, file), "utf8")).map(
          (hit) => `app/api/auth/${file}:${hit} never calls csrfProtection(request)`,
        ),
      );

    expect(missing).toEqual([]);
  });

  describe("reads a handler the way the rule says", () => {
    const call =
      "  const csrfError = await csrfProtection(request);\n  if (csrfError) return csrfError;\n";

    it("flags a handler without the call, at its own line", () => {
      const src = `import x from "y";\n\nexport async function DELETE(request) {\n  return ok();\n}\n`;
      expect(unchecked(src)).toEqual(["3 DELETE"]);
    });

    it("passes a handler that calls it", () => {
      const src = `export async function POST(request) {\n${call}  return ok();\n}\n`;
      expect(unchecked(src)).toEqual([]);
    });

    it("does not take the name in a comment for the call", () => {
      const src = `// csrfProtection(request)\nexport async function POST(request) {\n  /* csrfProtection(request) */\n  return ok();\n}\n`;
      expect(unchecked(src)).toEqual(["2 POST"]);
    });

    it("does not let one handler's call cover the handler beside it", () => {
      const src =
        `export async function POST(request) {\n${call}}\n\n` +
        `export async function DELETE(request) {\n  return ok();\n}\n`;
      expect(unchecked(src)).toEqual(["6 DELETE"]);
    });

    it("flags a handler re-exported under a state-changing name, which it cannot read", () => {
      expect(unchecked(`export { handler as GET, handler as POST };\n`)).toEqual(["1 POST"]);
    });

    it("takes a wrapped handler as checked", () => {
      expect(unchecked(`export const POST = withCsrfProtection(async () => ok());\n`)).toEqual([]);
    });

    it("leaves a read alone", () => {
      expect(unchecked(`export async function GET(request) {\n  return ok();\n}\n`)).toEqual([]);
    });
  });
});
