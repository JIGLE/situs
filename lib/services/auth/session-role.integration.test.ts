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
 * a row the registration gate admits through the allowlist is the administrator's, as before.
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

  const signIn = (email: string, profile?: unknown) =>
    jwt({
      token: {},
      user: { id: "google-sub-999", email, name: "Someone" },
      account: { provider: "google" },
      profile,
    });
  const invite = (email: string, role: "ADMIN" | "MANAGER") =>
    prisma.accessInvitation.create({
      data: { email, role, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
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

  it("provisions an identity the sign-in gate admits by the allowlist as the administrator, as before", async () => {
    const email = "allowlisted@example.com";
    process.env.AUTH_ALLOWED_EMAILS = email;

    try {
      const token = await signIn(email);

      expect(token.role).toBe("ADMIN");
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe("ADMIN");
    } finally {
      delete process.env.AUTH_ALLOWED_EMAILS;
    }
  });

  it("refuses an identity the gate does not admit, and creates nothing", async () => {
    const email = "stranger@example.com";

    await expect(signIn(email)).rejects.toThrow("USER_PROVISIONING_FAILED");

    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("provisions an invited identity as the role it was invited as, once Google has verified its email", async () => {
    const email = "invited@example.com";
    await invite(email, "MANAGER");

    const token = await signIn(email, { email_verified: true });

    expect(token.role).toBe("MANAGER");
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe("MANAGER");
    // The invitation is used up by the account it made.
    expect(await prisma.accessInvitation.count({ where: { email } })).toBe(0);
  });

  it("refuses an invited identity whose email Google has not verified, and keeps the invitation", async () => {
    const email = "unverified@example.com";
    await invite(email, "ADMIN");

    // Google saying no, and a sign-in that carries no word from Google at all.
    await expect(signIn(email, { email_verified: false })).rejects.toThrow(
      "USER_PROVISIONING_FAILED",
    );
    await expect(signIn(email)).rejects.toThrow("USER_PROVISIONING_FAILED");

    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(await prisma.accessInvitation.count({ where: { email } })).toBe(1);
  });
});
