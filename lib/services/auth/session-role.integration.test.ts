import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The role a Google sign-in carries is the one stored on the account.
 *
 * `auth.test.ts` proves the callback's logic against a mocked client. This asks the same of a real
 * SQLite file, through the real `upsert`: that the query returns the row's own role when the row
 * exists (not the one a new row would be given), that signing in changes nothing stored, and that
 * the role of a row the sign-in gate admitted for the first time is the administrator's, as before.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the flag
 * is the one thing a development environment may refuse to run.
 */
describe("the role a Google sign-in carries — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let jwt: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const signIn = (email: string) =>
    jwt({
      token: {},
      user: { id: "google-sub-999", email, name: "Someone" },
      account: { provider: "google" },
    });

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-role-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "e".repeat(64);
    prisma = await loadClient();
    const { getAuthOptions } = await import("@/lib/services/auth/auth");
    jwt = getAuthOptions().callbacks?.jwt as unknown as typeof jwt;
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it.each(["ADMIN", "MANAGER", "USER"] as const)(
    "signs an account stored as %s in as that role, and leaves the row as it was",
    async (role) => {
      const email = `stored-${role.toLowerCase()}@example.com`;
      const row = await prisma.user.create({ data: { email, role } });

      const token = await signIn(email);

      expect(token.role).toBe(role);
      expect(token.sub).toBe(row.id);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: row.id } })).role).toBe(role);
    },
  );

  it("provisions an identity the sign-in gate admitted for the first time as the administrator, as before", async () => {
    const email = "first-run@example.com";

    const token = await signIn(email);

    expect(token.role).toBe("ADMIN");
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe("ADMIN");
  });
});
