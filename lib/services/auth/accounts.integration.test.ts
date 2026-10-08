import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Who has an account and what each may be, against a real SQLite file: the rule that the instance
 * keeps an administrator, which only a database can show, and what is written and audited.
 *
 * The schema is pushed WITHOUT `--accept-data-loss`: a fresh file needs no such consent, and the flag
 * is the one thing a development environment may refuse to run.
 */
describe("accounts and their roles — real Prisma client + real SQLite file", () => {
  let tempDir: string;
  let prisma: Awaited<ReturnType<typeof loadClient>>;
  let accounts: typeof import("./accounts");

  async function loadClient() {
    const { getPrismaClient, resetPrismaClientForTests } =
      await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    return getPrismaClient();
  }

  const make = (email: string, role: "ADMIN" | "MANAGER" | "USER", createdAt?: Date) =>
    prisma.user.create({ data: { email, role, ...(createdAt ? { createdAt } : {}) } });
  const roleOf = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id } })).role;
  const audits = async () =>
    (await prisma.auditLog.findMany({ where: { action: "CHANGE_ACCOUNT_ROLE" } })).map((row) => ({
      ...row,
      details: JSON.parse(row.details ?? "{}"),
    }));

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "situs-accounts-test-"));
    const dbUrl = `file:${path.join(tempDir, "test.db")}`;

    execSync(`npx prisma db push --url="${dbUrl}"`, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = dbUrl;
    process.env.PII_ENCRYPTION_KEY = "e".repeat(64);
    // Read once, when the document service loads, which `./accounts` pulls in.
    process.env.DOCUMENT_STORAGE_PATH = path.join(tempDir, "documents");
    prisma = await loadClient();
    accounts = await import("./accounts");
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const { resetPrismaClientForTests } = await import("@/lib/services/database/database");
    resetPrismaClientForTests();
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("listing", () => {
    it("lists every account, the oldest first, and marks the reader's own", async () => {
      const second = await make("second@example.com", "MANAGER", new Date("2026-02-01"));
      const first = await make("first@example.com", "ADMIN", new Date("2026-01-01"));
      const legacy = await make("legacy@example.com", "USER", new Date("2026-03-01"));

      const listed = await accounts.listAccounts(second.id);

      expect(listed.map((row) => [row.id, row.role, row.self])).toEqual([
        [first.id, "ADMIN", false],
        [second.id, "MANAGER", true],
        [legacy.id, "USER", false],
      ]);
      expect(listed[0]).toMatchObject({ email: "first@example.com", name: null });
      expect(new Date(listed[0].createdAt).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("changing a role", () => {
    it("promotes a manager, and says who did it and what it was in the audit trail, with no email", async () => {
      const admin = await make("admin@example.com", "ADMIN");
      const manager = await make("manager@example.com", "MANAGER");

      const after = await accounts.changeAccountRole(admin.id, manager.id, "ADMIN");

      expect(after).toMatchObject({ id: manager.id, role: "ADMIN", self: false });
      expect(await roleOf(manager.id)).toBe("ADMIN");
      const [entry] = await audits();
      expect(entry).toMatchObject({
        userId: admin.id,
        resourceType: "user",
        resourceId: manager.id,
        details: { from: "MANAGER", to: "ADMIN" },
      });
      expect(JSON.stringify(entry)).not.toContain("manager@example.com");
    });

    it("makes a USER a manager", async () => {
      const admin = await make("admin@example.com", "ADMIN");
      const legacy = await make("legacy@example.com", "USER");

      await accounts.changeAccountRole(admin.id, legacy.id, "MANAGER");

      expect(await roleOf(legacy.id)).toBe("MANAGER");
    });

    it("demotes an administrator while another one remains, and keeps the account readable", async () => {
      const first = await make("first@example.com", "ADMIN");
      const second = await make("second@example.com", "ADMIN");
      const before = await prisma.user.findUniqueOrThrow({ where: { id: second.id } });

      const after = await accounts.changeAccountRole(first.id, second.id, "MANAGER");

      expect(after.role).toBe("MANAGER");
      const row = await prisma.user.findUniqueOrThrow({ where: { id: second.id } });
      expect(row.role).toBe("MANAGER");
      // The raw write stamps the time in the form Prisma reads back, and moves it.
      expect(row.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(await roleOf(first.id)).toBe("ADMIN");
    });

    it("lets an administrator demote themselves while another one remains", async () => {
      const first = await make("first@example.com", "ADMIN");
      await make("second@example.com", "ADMIN");

      const after = await accounts.changeAccountRole(first.id, first.id, "MANAGER");

      expect(after).toMatchObject({ role: "MANAGER", self: true });
    });

    it("refuses to demote the only administrator, and changes and audits nothing", async () => {
      const only = await make("only@example.com", "ADMIN");
      await make("manager@example.com", "MANAGER");

      await expect(accounts.changeAccountRole(only.id, only.id, "MANAGER")).rejects.toMatchObject({
        name: "ConflictError",
        reason: "last_admin",
      });

      expect(await roleOf(only.id)).toBe("ADMIN");
      expect(await audits()).toHaveLength(0);
    });

    it("leaves one administrator when two demote each other at the same moment", async () => {
      const a = await make("a@example.com", "ADMIN");
      const b = await make("b@example.com", "ADMIN");

      const results = await Promise.allSettled([
        accounts.changeAccountRole(a.id, b.id, "MANAGER"),
        accounts.changeAccountRole(b.id, a.id, "MANAGER"),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      // The one demoted first is no administrator when its own demotion is tried, so that is what it hears.
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ name: "ForbiddenError" });
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
      expect(await audits()).toHaveLength(1);
    });

    it("leaves one administrator when two demote themselves at the same moment", async () => {
      // Each is an administrator when it asks, and each sees the other still there: only a count made
      // by the demotion itself, after the first one landed, keeps the instance from being left with none.
      const a = await make("a@example.com", "ADMIN");
      const b = await make("b@example.com", "ADMIN");

      const results = await Promise.allSettled([
        accounts.changeAccountRole(a.id, a.id, "MANAGER"),
        accounts.changeAccountRole(b.id, b.id, "MANAGER"),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ name: "ConflictError", reason: "last_admin" });
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
      expect(await audits()).toHaveLength(1);
    });

    it("leaves one administrator when three demote one another in a circle", async () => {
      // Whichever demotion lands first takes its target out of the circle, so the one that was to
      // demote from there is no administrator when its turn comes, and is refused.
      const a = await make("a@example.com", "ADMIN");
      const b = await make("b@example.com", "ADMIN");
      const c = await make("c@example.com", "ADMIN");

      const results = await Promise.allSettled([
        accounts.changeAccountRole(a.id, b.id, "MANAGER"),
        accounts.changeAccountRole(b.id, c.id, "MANAGER"),
        accounts.changeAccountRole(c.id, a.id, "MANAGER"),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ name: "ForbiddenError" });
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
      expect(await audits()).toHaveLength(2);
    });

    it("applies two changes to the same account at the same moment to the account as it is, one after the other", async () => {
      // Both read the account as a USER. Whichever writes second finds it changed, reads it again and
      // changes it from what it now is, so the audit trail is a chain: each entry's "from" is what the
      // account really was. A write that does not name the role it read leaves two entries "from" USER.
      const a = await make("a@example.com", "ADMIN");
      const b = await make("b@example.com", "ADMIN");
      const target = await make("target@example.com", "USER");

      const results = await Promise.allSettled([
        accounts.changeAccountRole(a.id, target.id, "ADMIN"),
        accounts.changeAccountRole(b.id, target.id, "MANAGER"),
      ]);

      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const steps = (await audits()).map((entry) => `${entry.details.from}>${entry.details.to}`);
      const fromUser = steps.filter((step) => step.startsWith("USER>"));
      const after = steps.filter((step) => !step.startsWith("USER>"));
      // One change was made to the USER, the other to what that made it.
      expect(fromUser).toHaveLength(1);
      expect(after).toHaveLength(1);
      expect(after[0].split(">")[0]).toBe(fromUser[0].split(">")[1]);
      expect(await roleOf(target.id)).toBe(after[0].split(">")[1]);
    });

    describe("by someone who is no longer an administrator", () => {
      // The request began while they were one: `requireAdmin` let it through, and a demotion landed
      // before its write. The write is refused whatever it was going to do, and nothing changes.
      const demoted = async () => {
        const gone = await make("gone@example.com", "ADMIN");
        const stays = await make("stays@example.com", "ADMIN");
        await accounts.changeAccountRole(stays.id, gone.id, "MANAGER");
        await prisma.auditLog.deleteMany();
        return { gone, stays };
      };

      it("cannot give anyone a role, and changes and audits nothing", async () => {
        const { gone } = await demoted();
        const manager = await make("manager@example.com", "MANAGER");

        await expect(
          accounts.changeAccountRole(gone.id, manager.id, "ADMIN"),
        ).rejects.toMatchObject({ name: "ForbiddenError" });

        expect(await roleOf(manager.id)).toBe("MANAGER");
        expect(await audits()).toHaveLength(0);
      });

      it("cannot make themselves an administrator again", async () => {
        const { gone } = await demoted();

        await expect(accounts.changeAccountRole(gone.id, gone.id, "ADMIN")).rejects.toMatchObject({
          name: "ForbiddenError",
        });

        expect(await roleOf(gone.id)).toBe("MANAGER");
      });

      it("cannot demote an administrator, though another would remain", async () => {
        const { gone, stays } = await demoted();
        const other = await make("other@example.com", "ADMIN");

        await expect(
          accounts.changeAccountRole(gone.id, other.id, "MANAGER"),
        ).rejects.toMatchObject({ name: "ForbiddenError" });

        expect(await roleOf(other.id)).toBe("ADMIN");
        expect(await roleOf(stays.id)).toBe("ADMIN");
      });

      it("hears that before it hears that the instance needs an administrator", async () => {
        const { gone, stays } = await demoted();

        // `stays` is the only administrator: demoting them is refused for two reasons, and the
        // first thing wrong is who is asking.
        await expect(
          accounts.changeAccountRole(gone.id, stays.id, "MANAGER"),
        ).rejects.toMatchObject({ name: "ForbiddenError" });

        expect(await roleOf(stays.id)).toBe("ADMIN");
      });

      it("is the same for an account that no longer exists", async () => {
        const manager = await make("manager@example.com", "MANAGER");

        await expect(
          accounts.changeAccountRole("deleted", manager.id, "ADMIN"),
        ).rejects.toMatchObject({ name: "ForbiddenError" });

        expect(await roleOf(manager.id)).toBe("MANAGER");
        expect(await audits()).toHaveLength(0);
      });
    });

    it("is no change, and writes nothing, for the role the account already has", async () => {
      const admin = await make("admin@example.com", "ADMIN");
      const manager = await make("manager@example.com", "MANAGER");
      const before = await prisma.user.findUniqueOrThrow({ where: { id: manager.id } });

      const after = await accounts.changeAccountRole(admin.id, manager.id, "MANAGER");

      expect(after.role).toBe("MANAGER");
      const row = await prisma.user.findUniqueOrThrow({ where: { id: manager.id } });
      expect(row.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(await audits()).toHaveLength(0);
    });

    it("is a 404 for an account that is not there", async () => {
      const admin = await make("admin@example.com", "ADMIN");

      await expect(accounts.changeAccountRole(admin.id, "nobody", "MANAGER")).rejects.toMatchObject(
        { name: "ResourceNotFoundError" },
      );
    });

    it("touches no other account", async () => {
      const admin = await make("admin@example.com", "ADMIN");
      const other = await make("other@example.com", "ADMIN");
      const target = await make("target@example.com", "MANAGER");

      await accounts.changeAccountRole(admin.id, target.id, "ADMIN");

      expect(await roleOf(admin.id)).toBe("ADMIN");
      expect(await roleOf(other.id)).toBe("ADMIN");
    });
  });

  describe("deleting one's own account", () => {
    it("deletes a manager's account and everything it owns, and touches no other", async () => {
      const admin = await make("admin@example.com", "ADMIN");
      const manager = await make("manager@example.com", "MANAGER");
      await prisma.owner.create({ data: { userId: manager.id, name: "Landlord" } });
      await prisma.auditLog.create({ data: { userId: manager.id, action: "SOMETHING" } });
      await prisma.owner.create({ data: { userId: admin.id, name: "Other landlord" } });

      await accounts.deleteOwnAccount(manager.id);

      expect(await prisma.user.findUnique({ where: { id: manager.id } })).toBeNull();
      // By cascade, which a raw DELETE gets from the foreign keys as the Prisma delete did.
      expect(await prisma.owner.count({ where: { userId: manager.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { userId: manager.id } })).toBe(0);
      expect(await roleOf(admin.id)).toBe("ADMIN");
      expect(await prisma.owner.count({ where: { userId: admin.id } })).toBe(1);
    });

    it("lets an administrator go while another one remains", async () => {
      const first = await make("first@example.com", "ADMIN");
      const second = await make("second@example.com", "ADMIN");

      await accounts.deleteOwnAccount(first.id);

      expect(await prisma.user.findUnique({ where: { id: first.id } })).toBeNull();
      expect(await roleOf(second.id)).toBe("ADMIN");
    });

    it("keeps the only administrator while other accounts remain, and deletes nothing", async () => {
      const only = await make("only@example.com", "ADMIN");
      await make("manager@example.com", "MANAGER");
      await prisma.owner.create({ data: { userId: only.id, name: "Landlord" } });

      await expect(accounts.deleteOwnAccount(only.id)).rejects.toMatchObject({
        name: "ConflictError",
        reason: "last_admin",
      });

      expect(await roleOf(only.id)).toBe("ADMIN");
      expect(await prisma.owner.count({ where: { userId: only.id } })).toBe(1);
    });

    it("keeps the only administrator while a legacy USER account remains", async () => {
      const only = await make("only@example.com", "ADMIN");
      await make("legacy@example.com", "USER");

      await expect(accounts.deleteOwnAccount(only.id)).rejects.toMatchObject({
        reason: "last_admin",
      });
    });

    it("lets the only account of all go, which returns the instance to its first sign-in", async () => {
      const only = await make("only@example.com", "ADMIN");

      await accounts.deleteOwnAccount(only.id);

      expect(await prisma.user.count()).toBe(0);
    });

    it("leaves one administrator when two delete themselves at the same moment, with another account there", async () => {
      // Each is an administrator, and each sees the other still there: only a count made by the
      // delete itself, after the first one landed, keeps the instance from being left with none.
      const a = await make("a@example.com", "ADMIN");
      const b = await make("b@example.com", "ADMIN");
      await make("manager@example.com", "MANAGER");

      const results = await Promise.allSettled([
        accounts.deleteOwnAccount(a.id),
        accounts.deleteOwnAccount(b.id),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ name: "ConflictError", reason: "last_admin" });
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    });

    it("is a 404 for an account that is gone", async () => {
      await make("admin@example.com", "ADMIN");

      await expect(accounts.deleteOwnAccount("nobody")).rejects.toMatchObject({
        name: "ResourceNotFoundError",
      });
    });

    describe("what its rows do not take with them", () => {
      const mail = (userId: string | null, to: string) =>
        prisma.emailLog.create({
          data: { userId, to, from: "situs@example.com", subject: "Rent receipt", status: "sent" },
        });

      describe("the email log, which keeps its rows and the addresses in them", () => {
        it("deletes the account's rows, and keeps everyone else's and those that name no account", async () => {
          const admin = await make("admin@example.com", "ADMIN");
          const manager = await make("manager@example.com", "MANAGER");
          await mail(manager.id, "tenant@example.com");
          await mail(manager.id, "another@example.com");
          await mail(admin.id, "tenant-of-admin@example.com");
          await mail(null, "orphan@example.com");

          await accounts.deleteOwnAccount(manager.id);

          const left = (await prisma.emailLog.findMany()).map((row) => row.to).sort();
          expect(left).toEqual(["orphan@example.com", "tenant-of-admin@example.com"]);
        });

        it("puts the rows back when the deletion is refused", async () => {
          const only = await make("only@example.com", "ADMIN");
          await make("manager@example.com", "MANAGER");
          await mail(only.id, "tenant@example.com");

          await expect(accounts.deleteOwnAccount(only.id)).rejects.toMatchObject({
            reason: "last_admin",
          });

          // One transaction: the rows were deleted first, and the refusal rolled that back.
          expect(await prisma.emailLog.count({ where: { userId: only.id } })).toBe(1);
          expect(await prisma.user.findUnique({ where: { id: only.id } })).not.toBeNull();
        });
      });

      describe("a bank consent, which stays live at the bank", () => {
        let unregister: () => void;
        let fake: ReturnType<
          typeof import("@/lib/services/bank/providers/fake-provider").createFakeProvider
        >;

        const withFake = async (revokeResult?: Error) => {
          const [{ createFakeProvider }, { __registerProviderForTest }] = await Promise.all([
            import("@/lib/services/bank/providers/fake-provider"),
            import("@/lib/services/bank/providers/registry"),
          ]);
          fake = createFakeProvider({ key: "fake", revokeResult });
          unregister = __registerProviderForTest(fake);
        };
        const connect = (userId: string, consentId: string | null, provider = "psd2_fake") =>
          prisma.bankConnection.create({
            data: { userId, provider, institutionName: "Fake Bank", consentId, status: "active" },
          });

        afterEach(() => unregister?.());

        it("revokes every consent the account held once it is deleted, and says none was left", async () => {
          await withFake();
          await make("admin@example.com", "ADMIN");
          const manager = await make("manager@example.com", "MANAGER");
          await connect(manager.id, "session-1");
          await connect(manager.id, "session-2");
          await connect(manager.id, null, "manual");

          const result = await accounts.deleteOwnAccount(manager.id);

          expect(fake.revocations.sort()).toEqual(["session-1", "session-2"]);
          expect(result).toEqual({ bankConsentsNotRevoked: 0 });
          expect(await prisma.bankConnection.count({ where: { userId: manager.id } })).toBe(0);
        });

        it("counts a consent the bank would not end, so the holder can end it themselves", async () => {
          await withFake(new Error("bank is down"));
          await make("admin@example.com", "ADMIN");
          const manager = await make("manager@example.com", "MANAGER");
          await connect(manager.id, "session-1");

          expect(await accounts.deleteOwnAccount(manager.id)).toEqual({
            bankConsentsNotRevoked: 1,
          });
          // The account is gone all the same: a bank that is down does not hold an erasure back.
          expect(await prisma.user.findUnique({ where: { id: manager.id } })).toBeNull();
        });

        it("revokes nothing when the deletion is refused", async () => {
          await withFake();
          const only = await make("only@example.com", "ADMIN");
          await make("manager@example.com", "MANAGER");
          await connect(only.id, "session-1");

          await expect(accounts.deleteOwnAccount(only.id)).rejects.toMatchObject({
            reason: "last_admin",
          });

          expect(fake.revocations).toEqual([]);
          expect(await prisma.bankConnection.count({ where: { userId: only.id } })).toBe(1);
        });
      });

      describe("the stored files, which are on disk and not in a table", () => {
        const storage = () => process.env.DOCUMENT_STORAGE_PATH as string;
        const store = (userId: string) => {
          const folder = path.join(storage(), userId, "receipt", "2026-10");
          mkdirSync(folder, { recursive: true });
          writeFileSync(path.join(folder, "archive.pdf"), "%PDF-1.4 tenant name, address, amount");
          return path.join(storage(), userId);
        };

        it("removes the account's folder, and no other account's", async () => {
          await make("admin@example.com", "ADMIN");
          const manager = await make("manager@example.com", "MANAGER");
          const other = await make("other@example.com", "MANAGER");
          const mine = store(manager.id);
          const theirs = store(other.id);

          await accounts.deleteOwnAccount(manager.id);

          expect(existsSync(mine)).toBe(false);
          expect(existsSync(theirs)).toBe(true);
        });

        it("keeps the files when the deletion is refused", async () => {
          const only = await make("only@example.com", "ADMIN");
          await make("manager@example.com", "MANAGER");
          const mine = store(only.id);

          await expect(accounts.deleteOwnAccount(only.id)).rejects.toMatchObject({
            reason: "last_admin",
          });

          expect(existsSync(mine)).toBe(true);
        });

        it("is not held back by an account that never stored a file", async () => {
          await make("admin@example.com", "ADMIN");
          const manager = await make("manager@example.com", "MANAGER");

          await expect(accounts.deleteOwnAccount(manager.id)).resolves.toBeDefined();
        });
      });
    });
  });
});
