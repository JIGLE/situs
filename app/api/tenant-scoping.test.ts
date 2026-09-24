import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A standing guard, not a unit test.
 *
 * `proxy.ts` gates every /api/** route behind a session, but it only checks that a session
 * exists — never whose. Per-record ownership is each handler's own responsibility, and the
 * vendor-registry route simply never did it: three handlers looking a contact up by id alone, so
 * any signed-in user could read, edit or delete another landlord's contractor records. The file
 * contained the string `userId` zero times. (That route and its model have since been removed by
 * the scope cutdown, which is why this comment no longer names a file you can open — the shape of
 * the bug is the point, and it is still reachable by any new route that skips the scoping.)
 *
 * ## What this checks, and what it deliberately does not
 *
 * It fails a protected route file that touches a user-owned Prisma model while never mentioning
 * `userId` at all. That is precisely the shape of the bug above.
 *
 * It does NOT try to prove every individual query is scoped. The codebase's correct pattern is a
 * scoped guard followed by an unscoped write —
 *
 *     const existing = await prisma.building.findFirst({ where: { id, userId } });
 *     if (!existing) return 404;
 *     await prisma.building.update({ where: { id }, data });   // Prisma needs a unique selector
 *
 * — so "this query has no userId in its where clause" flags 22 sites of which 21 are correct.
 * A gate at that signal-to-noise ratio gets muted, and a muted gate catches nothing. This one
 * is narrow enough to stay trustworthy.
 *
 * ## Two blind spots, both demonstrated by a real IDOR this guard did not catch
 *
 * `app/api/distributions/route.ts` was wide open — unscoped reads and writes against another
 * landlord's property — and passed this test on both counts:
 *
 *  1. **A `userId` mention is not a scoping check.** The file contained `calculatedByUserId`,
 *     audit metadata recording who asked, constraining nothing. The `/userId|scopeUserId/`
 *     skip above treated that as evidence of scoping.
 *  2. **The query was in a service, not the route.** This walk only inspects direct
 *     `prisma.<model>.` calls, so a handler delegating to `lib/services/*` is invisible to it.
 *
 * Tightening either one costs more false positives than it is worth, so the coverage lives
 * elsewhere instead: `lib/services/income-distribution.scoping.test.ts` asserts on the `where`
 * clause the service actually issues. When a route delegates to a service, guard the service.
 */

const API_DIR = join(process.cwd(), "app", "api");
const SCHEMA = join(process.cwd(), "prisma", "schema.prisma");

// Public by design (the proxy.ts allowlist) — authenticated by token or provider signature
// rather than by session, so caller scoping does not apply in the same way.
const PUBLIC =
  /^(auth|health|ready|info|tenant-portal|csrf-token|monitoring|webhooks|debug|cron|metrics)\//;

/**
 * Models carrying their own `userId` column. Parsed per model body — a naive grep with a fixed
 * context window bleeds into the following model and mislabels ownerless models as owned, which
 * is exactly the false positive that sent the original investigation chasing
 * CorrespondenceTemplate (it has no owner column at all).
 */
function userOwnedModels(): Set<string> {
  const schema = readFileSync(SCHEMA, "utf8");
  const owned = new Set<string>();
  for (const model of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, name, body] = model;
    if (/^\s*userId\s+String/m.test(body)) {
      owned.add(name[0].toLowerCase() + name.slice(1)); // Prisma client property casing
    }
  }
  return owned;
}

function routeFiles(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith("route.ts") && !PUBLIC.test(f),
  );
}

function unscopedRoutes(): string[] {
  const owned = userOwnedModels();
  const offenders: string[] = [];

  for (const relative of routeFiles()) {
    const src = readFileSync(join(API_DIR, relative), "utf8");
    if (/userId|scopeUserId/.test(src)) continue; // scopes somehow; out of this guard's reach

    const touched = [...src.matchAll(/prisma\.(\w+)\./g)]
      .map((m) => m[1])
      .filter((model) => owned.has(model));

    if (touched.length > 0) {
      offenders.push(`app/api/${relative} — queries ${[...new Set(touched)].join(", ")}`);
    }
  }
  return offenders;
}

describe("app/api tenant scoping", () => {
  it("recognises the user-owned models in the schema", () => {
    const owned = userOwnedModels();
    expect(owned.has("receipt")).toBe(true);
    expect(owned.has("property")).toBe(true);
    // A nullable `userId String?` still counts as owned — EmailLog is the surviving example.
    // This pinned CorrespondenceTemplate until the scope cutdown removed it; the parser
    // property it proves is the same one.
    expect(owned.has("emailLog")).toBe(true);

    // A negative pin is what keeps this parser honest. PropertyOwner has no owner column of its
    // own and is immediately followed in the schema by GovernmentVerification, which does — so a
    // parser whose match bled past the closing brace would report it as owned and fail here.
    // That bleed is a real mistake already made once, by a grep with a fixed context window.
    expect(owned.has("propertyOwner")).toBe(false);
  });

  it("finds route files to scan (guards against the walk silently matching nothing)", () => {
    expect(routeFiles().length).toBeGreaterThan(50);
  });

  it("never queries user-owned data from a route that has no notion of the caller", () => {
    const offenders = unscopedRoutes();

    expect(
      offenders,
      `These routes read or write user-owned records without referencing userId anywhere.\n` +
        `proxy.ts proves a caller is signed in, not which records are theirs — scope the query\n` +
        `(\`where: { id, userId }\`) or verify ownership on the result before acting on it.\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
