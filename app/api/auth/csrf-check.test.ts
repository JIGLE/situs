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
 * route ever added under it, so here:
 *
 *  - a handler that changes state checks the token itself, first: it keeps the answer of
 *    `csrfProtection` and returns it, before it reads a body or touches the database;
 *  - a GET is a read, and is named in READS: a state change cannot be one, since a followed link
 *    carries the session and no token;
 *  - a handler that need not check says why, in EXEMPT, for that method and no other.
 *
 * This reads each handler's own source, comments blanked: a call in a comment, in the handler next
 * door or in a helper below it does not count. It scans app/api/auth only. The proxy's other public
 * prefixes (health, ready, info, csrf-token, monitoring, metrics, webhooks) were read by hand when
 * this was written, and hold no state-changing handler that a session authenticates.
 */

// Vitest runs with the repo root as cwd.
const AUTH_DIR = join(process.cwd(), "app", "api", "auth");

/** State-changing handlers that need not check the token, by route file and method, and why. */
const EXEMPT: Record<string, { methods: string[]; reason: string }> = {
  "[...nextauth]/route.ts": {
    methods: ["POST"],
    reason:
      "NextAuth checks its own csrfToken on sign-in, sign-out, the credentials callback and the " +
      "session update.",
  },
  "totp/verify/route.ts": {
    methods: ["POST"],
    reason:
      "A session that has passed only its first factor has to be able to send its code, and need " +
      "not hold a CSRF cookie: the proxy seeds it for portal pages, which that session is kept " +
      "out of. The route answers only a correct code, and is rate limited per account.",
  },
};

/** The GETs under /api/auth, each a read. A GET that is not named here fails. */
const READS: Record<string, string[]> = {
  "[...nextauth]/route.ts": ["GET"],
  "totp/status/route.ts": ["GET"],
};

const WRITES = ["POST", "PUT", "PATCH", "DELETE"];
const READ_METHODS = ["GET", "HEAD"];
const METHODS = [...WRITES, ...READ_METHODS];

/** The idiom, whole: the refusal is kept and returned. A call whose answer is dropped checks nothing. */
const CHECK =
  /\b([A-Za-z_$][\w$]*)\s*=\s*await\s+csrfProtection\s*\(\s*[\w$]+\s*\)\s*;\s*if\s*\(\s*\1\s*\)\s*return\s+\1\s*;/;
/** A wrapper that checks before the handler runs. */
const WRAPPED = /\bwithCsrfProtection\s*\(/;
/** Where a handler first reads a body or touches the database: the check has to come before it. */
const FIRST_USE =
  /\b(?:getPrismaClient|readJson|readJsonObject|parseJsonBody)\s*\(|\bprisma\s*\.|\b(?:request|req)\s*\.\s*(?:json|formData|text)\s*\(/;

/** Blank out comments, keeping every newline, so a line number still points at the real line. */
function withoutComments(src: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_all, lead: string, comment: string) => lead + blank(comment));
}

interface Handler {
  method: string;
  line: number;
  /** From its `export` to the next one: the handler, and whatever follows it. */
  segment: string;
  /** False for a re-export, whose body is in another file or another statement. */
  readable: boolean;
}

const DIRECT = /^export\s+(?:async\s+function|function|const)\s+(POST|PUT|PATCH|DELETE|GET|HEAD)\b/;

function handlers(src: string): Handler[] {
  const code = withoutComments(src);
  const starts = [...code.matchAll(/^export\b/gm)].map((m) => m.index);
  return starts.flatMap((start, i): Handler[] => {
    const segment = code.slice(start, starts[i + 1] ?? code.length);
    const line = code.slice(0, start).split("\n").length;

    const named = DIRECT.exec(segment);
    if (named) return [{ method: named[1], line, segment, readable: true }];

    // `export { handler as POST }`, `export { POST } from "./x"`, `export const { POST } = h`: a
    // list of names, with no body to read. Any method name in it counts, which errs towards flagging.
    const open = segment.indexOf("{");
    const close = segment.indexOf("}", open);
    const lead = segment.slice(0, Math.max(open, 0)).replace(/\s+/g, " ").trim();
    if (open < 0 || close < 0 || (lead !== "export" && lead !== "export const")) return [];
    return segment
      .slice(open + 1, close)
      .split(/[\s,:]+/)
      .filter((name) => METHODS.includes(name))
      .map((method) => ({ method, line, segment, readable: false }));
  });
}

/** `line METHOD reason` for every handler in `src` that breaks the rule. */
function audit(src: string, allowed: { exempt?: string[]; reads?: string[] } = {}): string[] {
  const { exempt = [], reads = [] } = allowed;
  return handlers(src).flatMap(({ method, line, segment, readable }) => {
    if (READ_METHODS.includes(method)) {
      return reads.includes(method)
        ? []
        : [`${line} ${method} is not a named read, and nothing here shows it changes nothing`];
    }
    if (exempt.includes(method)) return [];
    if (!readable) return [`${line} ${method} is re-exported, so its body is not here to read`];
    if (WRAPPED.test(segment)) return [];

    const check = CHECK.exec(segment);
    if (!check)
      return [`${line} ${method} never calls csrfProtection(request) and returns its refusal`];
    const use = FIRST_USE.exec(segment);
    if (use && use.index < check.index) {
      return [`${line} ${method} reads a body or touches the database before it checks the token`];
    }
    return [];
  });
}

function routeFiles(): string[] {
  return readdirSync(AUTH_DIR, { recursive: true, encoding: "utf8" })
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f.endsWith("route.ts"));
}

describe("a state-changing /api/auth handler checks the CSRF token itself", () => {
  it("finds the routes to scan (guards against the walk silently matching nothing)", () => {
    const files = routeFiles();
    for (const route of ["setup", "enable", "disable", "verify", "status"]) {
      expect(files).toContain(`totp/${route}/route.ts`);
    }
    expect(files).toContain("[...nextauth]/route.ts");
  });

  it("names only routes that exist, so a renamed route does not leave its exemption behind", () => {
    for (const file of [...Object.keys(EXEMPT), ...Object.keys(READS)]) {
      expect(existsSync(join(AUTH_DIR, file)), `${file} is named but is not a route`).toBe(true);
    }
  });

  it("has no handler that breaks the rule", () => {
    const broken = routeFiles().flatMap((file) =>
      audit(readFileSync(join(AUTH_DIR, file), "utf8"), {
        exempt: EXEMPT[file]?.methods,
        reads: READS[file],
      }).map((problem) => `app/api/auth/${file}:${problem}`),
    );

    expect(broken).toEqual([]);
  });

  describe("reads a handler the way the rule says", () => {
    const check =
      "  const csrfError = await csrfProtection(request);\n  if (csrfError) return csrfError;\n";

    it("flags a handler without the call, at its own line", () => {
      const src = `import x from "y";\n\nexport async function DELETE(request) {\n  return ok();\n}\n`;
      expect(audit(src)).toEqual([expect.stringMatching(/^3 DELETE never calls csrfProtection/)]);
    });

    it("passes a handler that checks first", () => {
      const src = `export async function POST(request) {\n${check}  const prisma = getPrismaClient();\n}\n`;
      expect(audit(src)).toEqual([]);
    });

    it("does not take the name in a comment for the call", () => {
      const src = `// csrfProtection(request)\nexport async function POST(request) {\n  /* ${check} */\n  return ok();\n}\n`;
      expect(audit(src)).toEqual([expect.stringMatching(/^2 POST never calls/)]);
    });

    it("does not let one handler's call cover the handler beside it", () => {
      const src =
        `export async function POST(request) {\n${check}}\n\n` +
        `export async function DELETE(request) {\n  return ok();\n}\n`;
      expect(audit(src)).toEqual([expect.stringMatching(/^6 DELETE never calls/)]);
    });

    it("flags a call whose refusal is dropped", () => {
      const src = `export async function POST(request) {\n  await csrfProtection(request);\n  return ok();\n}\n`;
      expect(audit(src)).toEqual([expect.stringMatching(/^1 POST never calls/)]);
    });

    it("flags a check made after the database has been touched, or the body read", () => {
      const afterDb = `export async function POST(request) {\n  const prisma = getPrismaClient();\n${check}}\n`;
      const afterBody = `export async function POST(request) {\n  const body = await request.json();\n${check}}\n`;
      expect(audit(afterDb)).toEqual([expect.stringMatching(/^1 POST reads a body or touches/)]);
      expect(audit(afterBody)).toEqual([expect.stringMatching(/^1 POST reads a body or touches/)]);
    });

    it("does not take a helper below the handler for its check", () => {
      const src =
        `export async function POST(request) {\n  const prisma = getPrismaClient();\n  return ok();\n}\n\n` +
        `async function later(request) {\n${check}}\n`;
      expect(audit(src)).toEqual([expect.stringMatching(/^1 POST reads a body or touches/)]);
    });

    it("takes a wrapped handler as checked", () => {
      expect(audit(`export const POST = withCsrfProtection(async () => ok());\n`)).toEqual([]);
    });

    it.each([
      `export { handler as GET, handler as POST };\n`,
      `export { POST };\n`,
      `export { POST } from "./other";\n`,
      `export const { POST } = handlers;\n`,
    ])("flags a state-changing handler it cannot read: %s", (src) => {
      expect(audit(src, { reads: ["GET"] })).toEqual([
        expect.stringMatching(/^1 POST is re-exported/),
      ]);
    });

    it("names a GET that is not a named read, which is how a link would change state", () => {
      const src = `export async function GET(request) {\n  return ok();\n}\n`;
      expect(audit(src)).toEqual([expect.stringMatching(/^1 GET is not a named read/)]);
      expect(audit(src, { reads: ["GET"] })).toEqual([]);
    });

    it("exempts a method, and no other method of the same file", () => {
      const src =
        `export async function POST(request) {\n  return ok();\n}\n\n` +
        `export async function DELETE(request) {\n  return ok();\n}\n`;
      expect(audit(src, { exempt: ["POST"] })).toEqual([
        expect.stringMatching(/^5 DELETE never calls/),
      ]);
    });
  });
});
