// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * `requireAdmin` reads the role an account holds now, so a demotion takes effect when it is made. A
 * route may ask it to trust the session's role instead when the role cannot be read
 * (`sessionRoleIfDatabaseDown`). That is what a diagnostics route needs, since it is opened when the
 * database is the thing that is broken, and it is never right for one that changes anything: the
 * token of an administrator demoted a moment ago lives a day.
 *
 * So the option is asked for by the status route and by no other file, and never by a handler that
 * writes. A guard that is too narrow reports clean, so this reads every source file under `app`,
 * `lib` and `components`, not only the files named `route.ts`: a helper in `lib` that passes the
 * option on would give a route that writes the same thing.
 */

const ROOT = process.cwd();
const OPTION = "sessionRoleIfDatabaseDown";
/** Where the option is defined and read: the one file that names it without asking for it. */
const DEFINITION = "lib/services/auth/auth-middleware.ts";
const ALLOWED = ["app/api/admin/system-status/route.ts"];
/**
 * A handler that changes things, in any form a route can export it: a named function or constant,
 * or a list of names (`export { handler as POST }`, `export { POST } from "./x"`,
 * `export const { POST } = h`), whose body is not here to read, so any write method in it counts.
 */
const WRITES =
  /\bexport\s+(?:async\s+function|function|const|let|var)\s+(?:POST|PUT|PATCH|DELETE)\b|\bexport\s+(?:const\s+)?\{[^}]*\b(?:POST|PUT|PATCH|DELETE)\b[^}]*\}/;

/**
 * In the defining file, a call that hands the option on: `requireAdmin(request, { …: true })`, or
 * `storedRole(session, id, true)`. Its own call, `storedRole(…, options.… === true)`, is neither.
 */
const ASKS_THROUGH_REQUIRE_ADMIN = /requireAdmin\s*\([^)]*sessionRoleIfDatabaseDown\s*:/;
const ASKS_THROUGH_STORED_ROLE = /storedRole\s*\([^)]*,\s*true\s*\)/;

const isSource = (file: string) => /\.tsx?$/.test(file) && !/\.(?:test|spec)\.tsx?$/.test(file);

function sources(): string[] {
  const walked = ["app", "lib", "components"].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" }).map((file) =>
      path.posix.join(dir, file.split(path.sep).join("/")),
    ),
  );
  const top = readdirSync(ROOT).filter((file) => /\.ts$/.test(file));
  return [...walked, ...top].filter(isSource);
}

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const files = sources();
const askers = files.filter((file) => file !== DEFINITION && read(file).includes(OPTION));

describe("the session's role standing in for the stored one", () => {
  it("finds what to scan (guards against the walk silently matching nothing)", () => {
    for (const file of [
      DEFINITION,
      ...ALLOWED,
      "app/api/admin/access/accounts/[id]/route.ts",
      "lib/services/auth/accounts.ts",
    ]) {
      expect(files, file).toContain(file);
    }
    expect(files.every((file) => !/\.(?:test|spec)\./.test(file))).toBe(true);
  });

  it("is asked for by the status route and by no other file", () => {
    expect(askers).toEqual(ALLOWED);
  });

  it("is never asked for by a handler that changes anything", () => {
    for (const file of askers) {
      expect(WRITES.test(read(file)), file).toBe(false);
    }
  });

  it("is not asked for by the file that defines it either, which only reads it", () => {
    // The scan above leaves that file out, since it names the option to define and read it. A wrapper
    // there that passed it on would be another way to the same trust, in the one file nothing else reads.
    const src = read(DEFINITION);
    expect(src).not.toMatch(ASKS_THROUGH_REQUIRE_ADMIN);
    expect(src).not.toMatch(ASKS_THROUGH_STORED_ROLE);
  });

  describe("reads a handler the way the rule says", () => {
    it.each([
      `export async function POST(request) {\n  return ok();\n}\n`,
      `export function DELETE(request) {\n  return ok();\n}\n`,
      `export const PUT = withErrorHandler(handler);\n`,
      `export const PATCH = handler;\n`,
      `export { handler as GET, handler as PATCH };\n`,
      `export { POST };\n`,
      `export { POST } from "./other";\n`,
      `export const { POST } = handlers;\n`,
    ])("takes this for a handler that changes things: %s", (src) => {
      expect(WRITES.test(src)).toBe(true);
    });

    it.each([
      `export async function GET(request) {\n  return ok();\n}\n`,
      `export const GET = withErrorHandler(handler);\nexport const OPTIONS = handleOptions;\n`,
      `export { handler as GET };\n`,
      `const POST = 1;\n`,
    ])("takes this for one that does not: %s", (src) => {
      expect(WRITES.test(src)).toBe(false);
    });
  });
});
