import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The seeder's cleanup used to swallow every failure with a `console.warn`, so that a developer
 * database missing a migration would not crash the API. It crashed anyway, later and worse: with
 * `tenants.portalAccessRevokedAt` absent, the tenant delete failed silently and the run died on
 * `Unique constraint failed on Owner.email` — owners it was about to recreate had never been
 * deleted. The reported error named the wrong table, the wrong constraint and the wrong cause.
 *
 * These tests pin the two halves of the replacement: schema drift is reported as schema drift with
 * the remedy attached, and nothing else is reinterpreted on the way past.
 */

const deleteMany = vi.fn();
const create = vi.fn();

vi.mock("./services/database", () => ({
  getPrismaClient: () =>
    new Proxy(
      {},
      {
        get: () => ({ deleteMany, create, createMany: create, findMany: () => [] }),
      },
    ),
}));

const prismaError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("demo seed cleanup", () => {
  beforeEach(() => {
    deleteMany.mockReset();
    create.mockReset();
    deleteMany.mockResolvedValue({ count: 0 });
    create.mockResolvedValue({ id: "x" });
  });

  it("reports a missing column as schema drift, naming the remedy", async () => {
    const { seedDemoData } = await import("./demo-seed");
    deleteMany.mockRejectedValueOnce(
      prismaError("P2022", "The column `main.tenants.portalAccessRevokedAt` does not exist"),
    );

    // One invocation, both assertions on the same error: `mockRejectedValueOnce` fires once, so
    // calling the seeder twice would let the second run sail past cleanup into the creates.
    const err = await seedDemoData("user-1").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    if (!err) throw new Error("unreachable");
    expect(err.message).toMatch(/behind prisma\/schema\.prisma/);
    expect(err.message).toMatch(/prisma db push/);
    expect(err.message).toContain("portalAccessRevokedAt");
  });

  it("reports a missing table the same way", async () => {
    const { seedDemoData } = await import("./demo-seed");
    deleteMany.mockRejectedValueOnce(
      prismaError("P2021", "The table `main.receipts` does not exist"),
    );

    await expect(seedDemoData("user-1")).rejects.toThrow(/P2021/);
  });

  it("keeps the original error for anything that is not drift", async () => {
    // The swallow's real cost was reinterpretation. A connection failure must still read as a
    // connection failure, not as advice to run a migration.
    const { seedDemoData } = await import("./demo-seed");
    deleteMany.mockRejectedValueOnce(prismaError("P1001", "Can't reach database server"));

    const err = await seedDemoData("user-1").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    if (!err) throw new Error("unreachable");
    expect(err.message).toMatch(/Can't reach database server/);
    expect(err.message).not.toMatch(/prisma db push/);
  });

  it("does not swallow a cleanup failure and continue to the creates", async () => {
    // The behaviour that produced the misleading message: cleanup fails, seeding carries on, and
    // the create collides with rows the cleanup was supposed to have removed.
    const { seedDemoData } = await import("./demo-seed");
    deleteMany.mockRejectedValueOnce(prismaError("P2022", "no such column"));

    await expect(seedDemoData("user-1")).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * Every model the seed creates must also be cleaned, or re-seeding stacks copies.
 *
 * This is not hypothetical twice over. Documents and the bank graph were created and never
 * cleared, so identical runs drifted 54 → 60 documents and 90 → 100 transactions and any
 * count-based baseline crept upward. Correspondence was the mirror image — cleaned since long
 * before anything created it — and the result was that every audit run measured the
 * Correspondence page's empty state and reported 484px of "wasted space" that was really "no
 * data". Both directions cost real time; both are one grep apart from being impossible.
 *
 * Read from the source rather than from a list, for the same reason the redirect-stub sweep is:
 * a list has to be updated by whoever forgot to update the cleanup.
 */
describe("seed cleanup covers everything the seed creates", () => {
  const source = readFileSync(path.join(process.cwd(), "lib", "demo-seed.ts"), "utf8");
  // Literal patterns, not a constructed one: `new RegExp(\`...${verb}\`)` trips
  // `security/detect-non-literal-regexp`, and the rule is right that a pattern assembled from a
  // variable is worth a second look even when the variable is a constant two lines above.
  const namesOf = (pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]));

  const created = namesOf(/prisma\.([a-zA-Z]+)\.create/g);
  const cleaned = namesOf(/prisma\.([a-zA-Z]+)\.deleteMany/g);

  /**
   * Cascade-covered: deleting the property takes these with it, so an explicit delete would be
   * redundant rather than missing. Verified against prisma/schema.prisma — Unit and Lease are
   * `onDelete: Cascade` from Property, RentPeriod from Lease and Property both.
   */
  const CASCADES_FROM_PROPERTY = new Set(["unit", "lease", "rentPeriod"]);

  it("finds both sets (an empty sweep would pass vacuously)", () => {
    expect(created.size).toBeGreaterThan(10);
    expect(cleaned.size).toBeGreaterThan(10);
  });

  it.each([...created].filter((m) => !CASCADES_FROM_PROPERTY.has(m)))(
    "%s is cleaned before it is created",
    (model) => {
      expect(cleaned.has(model)).toBe(true);
      // Order matters as much as presence: a delete that runs after the create clears the fixture
      // it was meant to replace.
      expect(source.indexOf(`prisma.${model}.deleteMany`)).toBeLessThan(
        source.indexOf(`prisma.${model}.create`),
      );
    },
  );

  it("seeds the three domains whose absence was read as a layout defect", () => {
    for (const model of [
      "correspondence",
      "correspondenceTemplate",
      "maintenanceContact",
      "taxFiling",
    ]) {
      expect(created.has(model)).toBe(true);
    }
  });
});
