import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The two sign-up switches and the invitations, against a real SQLite file: what is stored, what the
 * audit trail is told, and that the invitee's email is masked there. The gate that reads them is
 * `registration.integration.test.ts`.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the flag
 * is the one thing a development environment may refuse to run.
 */
describe("sign-up settings and invitations — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let signUp: typeof import("./sign-up");
  let adminId: string;

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const audits = async (action: string) =>
    (await prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } })).map(
      (row) => ({ ...row, details: JSON.parse(row.details ?? "{}") }),
    );

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-signup-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "e".repeat(64);
    prisma = await loadClient();
    signUp = await import("./sign-up");
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.accessInvitation.deleteMany();
    await prisma.instanceSettings.deleteMany();
    await prisma.user.deleteMany();
    adminId = (await prisma.user.create({ data: { email: "owner@example.com", role: "ADMIN" } }))
      .id;
  });

  describe("the switches", () => {
    it("start closed to Google and open to invitations, with nothing saved", async () => {
      expect(await signUp.getSignUpSettings()).toEqual({ googleSignUp: false, invitations: true });
      expect(await signUp.readSignUpSettings()).toEqual({ googleSignUp: false, invitations: true });
      expect(await prisma.instanceSettings.count()).toBe(0);
    });

    it("change one at a time, remember who changed them, and say each change in the audit trail", async () => {
      const after = await signUp.updateSignUpSettings(adminId, { googleSignUp: true });

      expect(after).toEqual({ googleSignUp: true, invitations: true });
      expect(await signUp.getSignUpSettings()).toEqual(after);
      expect(
        (await prisma.instanceSettings.findUniqueOrThrow({ where: { id: "instance" } }))
          .updatedById,
      ).toBe(adminId);
      const [entry] = await audits("SIGN_UP_SETTING_CHANGE");
      expect(entry.userId).toBe(adminId);
      expect(entry.details).toEqual({ setting: "googleSignUp", from: false, to: true });
      expect(await audits("SIGN_UP_SETTING_CHANGE")).toHaveLength(1);

      // A later change, by someone else, is remembered as theirs: the row already exists by then.
      const second = await prisma.user.create({
        data: { email: "second@example.com", role: "ADMIN" },
      });
      await signUp.updateSignUpSettings(second.id, { invitations: false });
      expect(
        (await prisma.instanceSettings.findUniqueOrThrow({ where: { id: "instance" } }))
          .updatedById,
      ).toBe(second.id);
    });

    it("audit both when both change, and none when nothing does", async () => {
      await signUp.updateSignUpSettings(adminId, { googleSignUp: true, invitations: false });
      expect((await audits("SIGN_UP_SETTING_CHANGE")).map((row) => row.details)).toEqual([
        { setting: "googleSignUp", from: false, to: true },
        { setting: "invitations", from: true, to: false },
      ]);

      await signUp.updateSignUpSettings(adminId, { googleSignUp: true, invitations: false });
      expect(await audits("SIGN_UP_SETTING_CHANGE")).toHaveLength(2);
    });

    it("keep the one that was not asked about", async () => {
      await signUp.updateSignUpSettings(adminId, { invitations: false });
      await signUp.updateSignUpSettings(adminId, { googleSignUp: true });

      expect(await signUp.getSignUpSettings()).toEqual({ googleSignUp: true, invitations: false });

      await signUp.updateSignUpSettings(adminId, { invitations: true });

      expect(await signUp.getSignUpSettings()).toEqual({ googleSignUp: true, invitations: true });
    });
  });

  describe("the invitations", () => {
    it("store the email lower-case, the role and a thirty-day life, and audit it masked", async () => {
      const before = Date.now();

      const made = await signUp.createInvitation(adminId, {
        email: "  Guest@Example.ORG ",
        role: "MANAGER",
      });

      expect(made).toMatchObject({ email: "guest@example.org", role: "MANAGER", expired: false });
      // Thirty days is what the documentation promises (DATA_PROTECTION.md), so it is asserted as a
      // number, not as whatever the constant happens to hold.
      const days = (new Date(made.expiresAt).getTime() - before) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(29.99);
      expect(days).toBeLessThan(30.01);
      expect(signUp.INVITATION_DAYS).toBe(30);
      const [entry] = await audits("CREATE_INVITATION");
      expect(entry.userId).toBe(adminId);
      expect(entry.resourceId).toBe(made.id);
      expect(entry.details).toEqual({ email: "g***@example.org", role: "MANAGER", renewed: false });
      // The trail never holds the address itself.
      expect(JSON.stringify(entry)).not.toContain("guest@example.org");
      // The invitation remembers who sent it.
      expect(
        (await prisma.accessInvitation.findUniqueOrThrow({ where: { id: made.id } })).invitedById,
      ).toBe(adminId);
    });

    it("refuse an email that already has an account", async () => {
      await prisma.user.create({ data: { email: "member@example.com", role: "MANAGER" } });

      await expect(
        signUp.createInvitation(adminId, { email: "Member@Example.com", role: "ADMIN" }),
      ).rejects.toMatchObject({ name: "ConflictError", reason: "account_exists" });

      expect(await prisma.accessInvitation.count()).toBe(0);
      expect(await audits("CREATE_INVITATION")).toHaveLength(0);
    });

    it("renew an invitation sent again: one row, the new role, a fresh life", async () => {
      const first = await signUp.createInvitation(adminId, {
        email: "guest@example.com",
        role: "MANAGER",
      });
      await prisma.accessInvitation.update({
        where: { id: first.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const again = await signUp.createInvitation(adminId, {
        email: "guest@example.com",
        role: "ADMIN",
      });

      expect(again.id).toBe(first.id);
      expect(again).toMatchObject({ role: "ADMIN", expired: false });
      expect(await prisma.accessInvitation.count()).toBe(1);
      expect((await audits("CREATE_INVITATION")).map((row) => row.details.renewed)).toEqual([
        false,
        true,
      ]);
    });

    it("are listed newest first, with the lapsed ones marked", async () => {
      const old = await signUp.createInvitation(adminId, {
        email: "old@example.com",
        role: "MANAGER",
      });
      await prisma.accessInvitation.update({
        where: { id: old.id },
        data: { createdAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1000) },
      });
      await signUp.createInvitation(adminId, { email: "new@example.com", role: "ADMIN" });

      const listed = await signUp.listInvitations();

      expect(listed.map((row) => [row.email, row.expired])).toEqual([
        ["new@example.com", false],
        ["old@example.com", true],
      ]);
    });

    it("are found for the gate only while they have not lapsed, by lower-case email", async () => {
      const made = await signUp.createInvitation(adminId, {
        email: "guest@example.com",
        role: "ADMIN",
      });

      expect(await signUp.findLiveInvitation(" Guest@Example.com")).toEqual({
        id: made.id,
        role: "ADMIN",
      });

      await prisma.accessInvitation.update({
        where: { id: made.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await signUp.findLiveInvitation("guest@example.com")).toBeNull();
    });

    it("are withdrawn, audited, and a 404 the second time", async () => {
      const made = await signUp.createInvitation(adminId, {
        email: "guest@example.com",
        role: "MANAGER",
      });

      await signUp.revokeInvitation(adminId, made.id);

      expect(await prisma.accessInvitation.count()).toBe(0);
      const [entry] = await audits("REVOKE_INVITATION");
      expect(entry.details).toEqual({ email: "g***@example.com", role: "MANAGER" });
      await expect(signUp.revokeInvitation(adminId, made.id)).rejects.toMatchObject({
        name: "ResourceNotFoundError",
      });
      expect(await audits("REVOKE_INVITATION")).toHaveLength(1);
    });
  });

  describe("retention", () => {
    it("removes the invitations that lapsed and keeps the live ones", async () => {
      const { runDataRetention } = await import("@/lib/services/data-retention");
      const lapsed = await signUp.createInvitation(adminId, {
        email: "lapsed@example.com",
        role: "MANAGER",
      });
      await signUp.createInvitation(adminId, { email: "live@example.com", role: "MANAGER" });
      await prisma.accessInvitation.update({
        where: { id: lapsed.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const result = await runDataRetention();

      expect(result.expiredInvitationsDeleted).toBe(1);
      expect((await prisma.accessInvitation.findMany()).map((row) => row.email)).toEqual([
        "live@example.com",
      ]);
    });
  });
});
