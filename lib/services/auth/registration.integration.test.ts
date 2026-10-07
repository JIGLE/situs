import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Who may create an account, and as what, against a real SQLite file.
 *
 * `registration.test.ts` proves the policy with a mocked client. This asks the questions only rows
 * can answer: that an invitation is used up by the account it makes, in the same transaction; that
 * two sign-ins of one new email make one account; that an existing account is returned with the role
 * it holds, whatever the switches say; and that a table the gate cannot read closes the new-account
 * doors and nothing else.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the flag
 * is the one thing a development environment may refuse to run.
 */
describe("who may create an account — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let provisionAccount: typeof import("./registration").provisionAccount;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  // Google has verified the email unless a case says it has not.
  const signUp = (email: string, provider = "google", emailVerified = true) =>
    provisionAccount({ email, name: "Someone", image: null, provider, emailVerified });
  const closed = (email: string, provider?: string) =>
    expect(signUp(email, provider)).rejects.toThrow("REGISTRATION_CLOSED");
  const unverified = (email: string) =>
    expect(signUp(email, "google", false)).rejects.toThrow("EMAIL_UNVERIFIED");
  const accountsNamed = (email: string) => prisma.user.count({ where: { email } });
  const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });

  /** The instance already has an owner, so nobody is the first. */
  async function owner() {
    return prisma.user.create({ data: { email: "owner@example.com", role: "ADMIN" } });
  }

  async function invite(email: string, role: "ADMIN" | "MANAGER", expiresAt = days(30)) {
    return prisma.accessInvitation.create({ data: { email, role, expiresAt } });
  }

  const setSwitches = (googleSignUp: boolean, invitations: boolean) =>
    prisma.instanceSettings.upsert({
      where: { id: "instance" },
      update: { googleSignUp, invitations },
      create: { id: "instance", googleSignUp, invitations },
    });

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-registration-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "e".repeat(64);
    prisma = await loadClient();
    ({ provisionAccount } = await import("./registration"));
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  // Every case starts from an empty instance, and says what it needs.
  beforeEach(async () => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    await prisma.auditLog.deleteMany();
    await prisma.accessInvitation.deleteMany();
    await prisma.instanceSettings.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    delete process.env.AUTH_ALLOWED_EMAILS;
  });

  it("makes the first account the administrator, and says how it was let in", async () => {
    const created = await signUp("first@example.com");

    expect(created.role).toBe("ADMIN");
    const [entry] = await audits("CREATE_ACCOUNT");
    expect(entry.userId).toBe(created.id);
    expect(JSON.parse(entry.details ?? "{}")).toEqual({ reason: "bootstrap", role: "ADMIN" });
  });

  it("refuses a stranger on a claimed instance, and leaves nothing behind", async () => {
    await owner();

    await closed("stranger@example.com");

    expect(await accountsNamed("stranger@example.com")).toBe(0);
    expect(await audits("CREATE_ACCOUNT")).toHaveLength(0);
  });

  it("makes an allowlisted email an administrator", async () => {
    await owner();
    process.env.AUTH_ALLOWED_EMAILS = "Partner@Example.com";

    const created = await signUp("partner@example.com");

    expect(created.role).toBe("ADMIN");
  });

  it.each(["ADMIN", "MANAGER"] as const)(
    "makes an invited email the %s it was invited as, and uses the invitation up",
    async (role) => {
      await owner();
      await invite("guest@example.com", role);

      const created = await signUp("guest@example.com");

      expect(created.role).toBe(role);
      expect(await prisma.accessInvitation.count()).toBe(0);
      const [entry] = await audits("CREATE_ACCOUNT");
      expect(JSON.parse(entry.details ?? "{}")).toEqual({ reason: "invited", role });
    },
  );

  it("makes no account when the invitation it would use up cannot be removed", async () => {
    await owner();
    await invite("guest@example.com", "MANAGER");
    // The account and the used-up invitation are one transaction: if the second fails, the first
    // never happened, and the owner's invitation is still there.
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER keep_invitation BEFORE DELETE ON access_invitations BEGIN SELECT RAISE(ABORT, 'invitation is locked'); END",
    );
    try {
      await expect(signUp("guest@example.com")).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER keep_invitation");
    }

    expect(await accountsNamed("guest@example.com")).toBe(0);
    expect(await prisma.accessInvitation.count()).toBe(1);
    expect(await audits("CREATE_ACCOUNT")).toHaveLength(0);
  });

  it("does not admit an email whose invitation has lapsed", async () => {
    await owner();
    await invite("late@example.com", "MANAGER", days(-1));

    await closed("late@example.com");

    expect(await accountsNamed("late@example.com")).toBe(0);
  });

  it("does not admit an invited email while the invitations switch is off, and keeps the invitation", async () => {
    await owner();
    await invite("guest@example.com", "MANAGER");
    await setSwitches(false, false);

    await closed("guest@example.com");

    expect(await prisma.accessInvitation.count()).toBe(1);
  });

  it("makes any Google account a manager while Google sign-up is on, and no other provider's", async () => {
    await owner();
    await setSwitches(true, false);

    const created = await signUp("anyone@example.com", "google");
    await closed("someone-else@example.com", "github");

    expect(created.role).toBe("MANAGER");
    expect(await accountsNamed("someone-else@example.com")).toBe(0);
  });

  it("refuses an invited email the provider has not verified, keeps the invitation and makes no account", async () => {
    await owner();
    await invite("guest@example.com", "ADMIN");

    await unverified("guest@example.com");

    expect(await accountsNamed("guest@example.com")).toBe(0);
    expect(await prisma.accessInvitation.count()).toBe(1);
    expect(await audits("CREATE_ACCOUNT")).toHaveLength(0);
  });

  it("refuses open Google sign-up for an email the provider has not verified", async () => {
    await owner();
    await setSwitches(true, false);

    await unverified("anyone@example.com");

    expect(await accountsNamed("anyone@example.com")).toBe(0);
  });

  it("admits the first account and an allowlisted one whatever the provider says of their email", async () => {
    expect((await signUp("first@example.com", "google", false)).role).toBe("ADMIN");

    process.env.AUTH_ALLOWED_EMAILS = "partner@example.com";
    expect((await signUp("partner@example.com", "google", false)).role).toBe("ADMIN");
  });

  it("lets an invitation as an administrator outrank open Google sign-up", async () => {
    await owner();
    await setSwitches(true, true);
    await invite("boss@example.com", "ADMIN");

    expect((await signUp("boss@example.com")).role).toBe("ADMIN");
  });

  it("returns an existing account as it is, with the role it holds, whatever the switches say", async () => {
    await owner();
    await setSwitches(false, false);
    const manager = await prisma.user.create({ data: { email: "m@example.com", role: "MANAGER" } });
    const legacy = await prisma.user.create({ data: { email: "u@example.com", role: "USER" } });

    expect(await signUp("m@example.com")).toEqual({ id: manager.id, role: "MANAGER" });
    expect(await signUp("u@example.com")).toEqual({ id: legacy.id, role: "USER" });
    // Nor does what Google says of the email: an account that exists is not asked to prove it again.
    expect(await signUp("m@example.com", "google", false)).toEqual({
      id: manager.id,
      role: "MANAGER",
    });
    // Signing in changed nothing and made no account.
    expect(await audits("CREATE_ACCOUNT")).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: manager.id } })).role).toBe(
      "MANAGER",
    );
  });

  it("makes one account when the same new email signs in twice at once", async () => {
    await owner();
    await invite("twin@example.com", "MANAGER");

    const [a, b] = await Promise.all([signUp("twin@example.com"), signUp("twin@example.com")]);

    expect(a.id).toBe(b.id);
    expect(await accountsNamed("twin@example.com")).toBe(1);
    expect(await prisma.accessInvitation.count()).toBe(0);
  });

  it("closes the new-account doors, and only those, when the settings table cannot be read", async () => {
    const claimed = await owner();
    await invite("guest@example.com", "ADMIN");
    await setSwitches(true, true);
    await prisma.$executeRawUnsafe("DROP TABLE instance_settings");

    // Neither switch can be read, so an invitation admits nobody and Google sign-up is shut ...
    await closed("guest@example.com");
    await closed("anyone@example.com");
    // ... and the owner, who never needed one, still signs in.
    expect(await signUp("owner@example.com")).toEqual({ id: claimed.id, role: "ADMIN" });
  });
});
