import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Turning the second factor on ends the sessions that were already there.
 *
 * `auth.test.ts` proves the callback against a mocked client. This asks the same of a real SQLite
 * file and the real `jwt` callback: the column exists and round-trips, a session signed in before
 * the stamp is refused on its next refresh, one signed in after it is not, and an account that was
 * never stamped is untouched.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent.
 */
describe("sessions ended by the second factor — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let jwt: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  let clearCache: () => void;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  /** The sign-in the callback sees for an existing account. */
  const signIn = (email: string) =>
    jwt({
      token: {},
      user: { id: "google-sub-999", email, name: "Someone" },
      account: { provider: "google" },
    });

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-epoch-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "e".repeat(64);
    process.env.NEXTAUTH_SECRET = "epoch-integration-secret-0123456789-abcdefgh";
    prisma = await loadClient();
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    jwt = getAuthOptions().callbacks?.jwt as unknown as typeof jwt;
    ({ clearSessionEpochCache: clearCache } = await import("@/lib/services/auth/session-epoch"));
  }, 90_000);

  beforeEach(() => clearCache());

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("leaves an account that was never stamped alone", async () => {
    await prisma.user.create({ data: { email: "never@example.com", role: "ADMIN" } });
    const session = await signIn("never@example.com");

    clearCache();
    await expect(jwt({ token: session })).resolves.toMatchObject({ signedAt: session.signedAt });
  });

  it("ends a session signed in before the stamp, and keeps one signed in after it", async () => {
    const row = await prisma.user.create({ data: { email: "owner@example.com", role: "ADMIN" } });
    const old = await signIn("owner@example.com");
    const oldSignedAt = old.signedAt as number;

    // The enable route's write: the stamp is a moment after the old session began.
    const stamp = new Date(oldSignedAt + 1_000);
    await prisma.user.update({ where: { id: row.id }, data: { sessionsValidFrom: stamp } });
    const stored = await prisma.user.findUnique({
      where: { id: row.id },
      select: { sessionsValidFrom: true },
    });
    expect(stored?.sessionsValidFrom?.getTime()).toBe(stamp.getTime());

    clearCache();
    await expect(jwt({ token: old })).rejects.toThrow("SESSION_ENDED");

    // A sign-in after the stamp is a new session: the stamp is read as it stands, and it passes.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const fresh = await signIn("owner@example.com");
    expect(fresh.signedAt as number).toBeGreaterThanOrEqual(stamp.getTime());
    clearCache();
    await expect(jwt({ token: fresh })).resolves.toMatchObject({ signedAt: fresh.signedAt });
  });

  it("ends a session from before sessions had a sign-in time", async () => {
    const row = await prisma.user.create({ data: { email: "legacy@example.com", role: "ADMIN" } });
    await prisma.user.update({ where: { id: row.id }, data: { sessionsValidFrom: new Date() } });

    clearCache();
    await expect(
      jwt({ token: { sub: row.id, id: row.id, email: "legacy@example.com", uidVerified: true } }),
    ).rejects.toThrow("SESSION_ENDED");
  });
});
