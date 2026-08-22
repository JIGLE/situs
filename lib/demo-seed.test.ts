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
