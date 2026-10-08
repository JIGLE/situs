import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * How `changeAccountRole` writes, with the database mocked. The rules themselves, that the instance
 * keeps an administrator and that only one who still is one can change a role, are
 * `accounts.integration.test.ts`'s, since only a file can show them; this pins the shape of the write,
 * which is what they rest on: one statement that names the role it read, checks the one asking and
 * counts, and what is said when it writes nothing.
 */

const { prismaMock, txMock, logAuditMock, revokeAtBankMock, removeUserDocumentsMock } = vi.hoisted(
  () => {
    // What runs inside the deletion's transaction: the email log's rows and the one DELETE.
    const txMock = {
      emailLog: { deleteMany: vi.fn() },
      bankConnection: { findMany: vi.fn() },
      $executeRaw: vi.fn(),
    };
    return {
      txMock,
      prismaMock: {
        user: { findUnique: vi.fn(), findMany: vi.fn() },
        $executeRaw: vi.fn(),
        $transaction: vi.fn(),
      },
      logAuditMock: vi.fn(),
      revokeAtBankMock: vi.fn(),
      removeUserDocumentsMock: vi.fn(),
    };
  },
);

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/document-service", () => ({
  removeUserDocuments: removeUserDocumentsMock,
}));
vi.mock("@/lib/services/bank/connections", async () => ({
  // The real outcome check, so what counts as "ended" is not re-stated here.
  ...(await vi.importActual<typeof import("@/lib/services/bank/connections")>(
    "@/lib/services/bank/connections",
  )),
  revokeAtBank: revokeAtBankMock,
}));

import { changeAccountRole, deleteOwnAccount } from "./accounts";

const row = (role: string, id = "target") => ({
  id,
  email: `${id}@example.com`,
  name: null,
  role,
  createdAt: new Date("2026-01-01"),
});

/** The statement of the nth write: its text with `?` where a value is bound, and the values. */
const statement = (n = 0) => {
  const [strings, ...bound] = prismaMock.$executeRaw.mock.calls[n];
  return { sql: (strings as string[]).join("?"), bound };
};

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.$transaction.mockImplementation(async (work: (tx: typeof txMock) => unknown) =>
    work(txMock),
  );
  txMock.bankConnection.findMany.mockResolvedValue([]);
  txMock.emailLog.deleteMany.mockResolvedValue({ count: 0 });
  removeUserDocumentsMock.mockResolvedValue(true);
});

describe("changeAccountRole", () => {
  it("writes with one statement that binds the new role, the account, the role it was read with and who asks", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row("USER"));
    prismaMock.$executeRaw.mockResolvedValue(1);

    await changeAccountRole("admin-1", "target", "MANAGER");

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    const { sql, bound } = statement();
    expect(sql).toMatch(/UPDATE "User"/);
    expect(bound).toEqual(["MANAGER", "target", "USER", "admin-1"]);
    // The role it was read with is part of the statement, so a change made meanwhile is not overwritten.
    expect(sql).toMatch(/"id" = \?\s+AND "role" = \?/);
  });

  it("writes only while the one asking is still an administrator, in the same statement", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row("USER"));
    prismaMock.$executeRaw.mockResolvedValue(1);

    await changeAccountRole("admin-1", "target", "MANAGER");

    // Checked as it writes, not read before: a demotion that lands between the two would not be seen.
    expect(statement().sql).toMatch(
      /EXISTS \(SELECT 1 FROM "User" WHERE "id" = \? AND "role" = 'ADMIN'\)/,
    );
  });

  it("counts the administrators in the same statement, for an administrator being demoted", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row("ADMIN"));
    prismaMock.$executeRaw.mockResolvedValue(1);

    await changeAccountRole("admin-1", "target", "MANAGER");

    const { sql, bound } = statement();
    expect(sql).toMatch(
      /\("role" <> 'ADMIN' OR \(SELECT COUNT\(\*\) FROM "User" WHERE "role" = 'ADMIN'\) > 1\)/,
    );
    expect(bound).toEqual(["MANAGER", "target", "ADMIN", "admin-1"]);
    // Nothing is read to decide it: the statement did.
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("does not overwrite an account that changed after it was read: it reads it again", async () => {
    // Read as a USER; by the time of the write it has been made an administrator by someone else.
    prismaMock.user.findUnique
      .mockResolvedValueOnce(row("USER"))
      .mockResolvedValueOnce(row("ADMIN"));
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.user.findMany
      .mockResolvedValueOnce([
        { id: "admin-1", role: "ADMIN" },
        { id: "target", role: "ADMIN" },
      ])
      // It is now the only administrator, so the demotion is refused rather than slipping through.
      .mockResolvedValueOnce([
        { id: "admin-1", role: "ADMIN" },
        { id: "target", role: "ADMIN" },
      ]);

    await expect(changeAccountRole("admin-1", "target", "MANAGER")).rejects.toMatchObject({
      reason: "last_admin",
    });

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(statement(0).bound).toEqual(["MANAGER", "target", "USER", "admin-1"]);
    expect(statement(1).bound).toEqual(["MANAGER", "target", "ADMIN", "admin-1"]);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("takes an account demoted by someone else in the meantime as already done, and audits nothing", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(row("ADMIN"))
      .mockResolvedValueOnce(row("MANAGER"));
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin-1", role: "ADMIN" },
      { id: "target", role: "MANAGER" },
    ]);

    await expect(changeAccountRole("admin-1", "target", "MANAGER")).resolves.toMatchObject({
      role: "MANAGER",
    });

    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("gives up with a 409 after three reads that each changed under it", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row("USER"));
    prismaMock.$executeRaw.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "admin-1", role: "ADMIN" },
      { id: "target", role: "MANAGER" },
    ]);

    await expect(changeAccountRole("admin-1", "target", "MANAGER")).rejects.toMatchObject({
      name: "ConflictError",
      reason: "account_changed",
    });

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(3);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(3);
  });

  describe("when the one asking is no longer an administrator", () => {
    it.each([
      [
        "demoted meanwhile",
        [
          { id: "target", role: "USER" },
          { id: "admin-1", role: "MANAGER" },
        ],
      ],
      ["gone meanwhile", [{ id: "target", role: "USER" }]],
    ])("is a 403, not tried again, and audits nothing: %s", async (_name, rows) => {
      prismaMock.user.findUnique.mockResolvedValue(row("USER"));
      prismaMock.$executeRaw.mockResolvedValue(0);
      prismaMock.user.findMany.mockResolvedValue(rows);

      await expect(changeAccountRole("admin-1", "target", "ADMIN")).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "Forbidden: Admin access required",
      });

      expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
      expect(logAuditMock).not.toHaveBeenCalled();
    });

    it("says so before it says the instance needs an administrator", async () => {
      // The target is the only administrator, and the one asking was demoted a moment ago: the first
      // thing wrong is who is asking, and that is what the answer says.
      prismaMock.user.findUnique.mockResolvedValue(row("ADMIN"));
      prismaMock.$executeRaw.mockResolvedValue(0);
      prismaMock.user.findMany.mockResolvedValue([
        { id: "target", role: "ADMIN" },
        { id: "admin-1", role: "MANAGER" },
      ]);

      await expect(changeAccountRole("admin-1", "target", "MANAGER")).rejects.toMatchObject({
        name: "ForbiddenError",
      });
    });
  });

  it("audits what it wrote, as the one who wrote it, and nothing when it wrote nothing", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row("USER"));
    prismaMock.$executeRaw.mockResolvedValue(1);

    await changeAccountRole("admin-1", "target", "ADMIN");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      userId: "admin-1",
      action: "CHANGE_ACCOUNT_ROLE",
      resourceType: "user",
      resourceId: "target",
      details: { from: "USER", to: "ADMIN" },
    });

    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue(row("ADMIN"));
    await changeAccountRole("admin-1", "target", "ADMIN");
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});

/** The DELETE of the account, which runs inside the transaction. */
const deleteStatement = () => {
  const [strings, ...bound] = txMock.$executeRaw.mock.calls[0];
  return { sql: (strings as string[]).join("?"), bound };
};

describe("deleteOwnAccount", () => {
  it("deletes with one statement that binds the account, and reads nothing when it deletes", async () => {
    txMock.$executeRaw.mockResolvedValue(1);

    await deleteOwnAccount("target");

    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    const { sql, bound } = deleteStatement();
    expect(sql).toMatch(/DELETE FROM "User"\s+WHERE "id" = \?/);
    expect(bound).toEqual(["target"]);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("keeps the only administrator while others remain, in the same statement", async () => {
    txMock.$executeRaw.mockResolvedValue(1);

    await deleteOwnAccount("target");

    // Not an administrator, or another one exists, or it is the only account there is: decided as it
    // deletes, since another account can go between a count and a delete.
    expect(deleteStatement().sql).toMatch(
      /\("role" <> 'ADMIN'\s+OR \(SELECT COUNT\(\*\) FROM "User" WHERE "role" = 'ADMIN'\) > 1\s+OR \(SELECT COUNT\(\*\) FROM "User"\) = 1\)/,
    );
  });

  it("deletes the account's email log rows in the same transaction, since they outlive it otherwise", async () => {
    txMock.$executeRaw.mockResolvedValue(1);

    await deleteOwnAccount("target");

    expect(txMock.emailLog.deleteMany).toHaveBeenCalledWith({ where: { userId: "target" } });
    // Before the account, while the rows still name it.
    expect(txMock.emailLog.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.$executeRaw.mock.invocationCallOrder[0],
    );
  });

  describe("when the statement refuses", () => {
    it("is a 409 last_admin for an account that is still an administrator", async () => {
      txMock.$executeRaw.mockResolvedValue(0);
      prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN" });

      await expect(deleteOwnAccount("target")).rejects.toMatchObject({
        name: "ConflictError",
        reason: "last_admin",
      });
    });

    it("is a 409 account_changed when it was the only administrator a moment ago and is not now", async () => {
      txMock.$executeRaw.mockResolvedValue(0);
      prismaMock.user.findUnique.mockResolvedValue({ role: "MANAGER" });

      await expect(deleteOwnAccount("target")).rejects.toMatchObject({
        name: "ConflictError",
        reason: "account_changed",
      });
    });

    it("is a 404 for an account that is gone", async () => {
      txMock.$executeRaw.mockResolvedValue(0);
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(deleteOwnAccount("target")).rejects.toMatchObject({
        name: "ResourceNotFoundError",
      });
    });

    it("rolls the transaction back, and revokes no consent and removes no file", async () => {
      txMock.bankConnection.findMany.mockResolvedValue([
        { provider: "psd2_enablebanking", consentId: "session-1" },
      ]);
      txMock.$executeRaw.mockResolvedValue(0);
      prismaMock.user.findUnique.mockResolvedValue({ role: "ADMIN" });

      await expect(deleteOwnAccount("target")).rejects.toMatchObject({ reason: "last_admin" });

      // The error leaves the transaction callback, which is what rolls the email log deletion back
      // (accounts.integration.test.ts shows it on a real file).
      expect(revokeAtBankMock).not.toHaveBeenCalled();
      expect(removeUserDocumentsMock).not.toHaveBeenCalled();
    });
  });

  describe("after the account is gone", () => {
    const connection = (provider: string, consentId: string | null) => ({ provider, consentId });

    it("revokes each bank consent the account held, once it is deleted", async () => {
      txMock.bankConnection.findMany.mockResolvedValue([
        connection("psd2_enablebanking", "session-1"),
        connection("psd2_enablebanking", "session-2"),
      ]);
      txMock.$executeRaw.mockResolvedValue(1);
      revokeAtBankMock.mockResolvedValue("revoked");

      const result = await deleteOwnAccount("target");

      expect(revokeAtBankMock).toHaveBeenCalledWith("psd2_enablebanking", "session-1");
      expect(revokeAtBankMock).toHaveBeenCalledWith("psd2_enablebanking", "session-2");
      expect(revokeAtBankMock.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.$executeRaw.mock.invocationCallOrder[0],
      );
      expect(result).toEqual({ bankConsentsNotRevoked: 0 });
    });

    it("reads the consents inside the transaction, after the email log write and before the DELETE", async () => {
      txMock.$executeRaw.mockResolvedValue(1);

      await deleteOwnAccount("target");

      expect(txMock.bankConnection.findMany).toHaveBeenCalledWith({
        where: { userId: "target", status: { not: "pending_consent" } },
        select: { provider: true, consentId: true },
      });
      const [read] = txMock.bankConnection.findMany.mock.invocationCallOrder;
      expect(read).toBeGreaterThan(txMock.emailLog.deleteMany.mock.invocationCallOrder[0]);
      expect(read).toBeLessThan(txMock.$executeRaw.mock.invocationCallOrder[0]);
    });

    it("gives the transaction room for a large cascade", async () => {
      txMock.$executeRaw.mockResolvedValue(1);

      await deleteOwnAccount("target");

      expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 60_000,
        maxWait: 10_000,
      });
    });

    it("asks only for connections that hold a bank consent", async () => {
      txMock.bankConnection.findMany.mockResolvedValue([
        connection("manual", null),
        connection("csv", "stale"),
        connection("psd2_enablebanking", null),
        connection("psd2_enablebanking", "session-1"),
      ]);
      txMock.$executeRaw.mockResolvedValue(1);
      revokeAtBankMock.mockResolvedValue("revoked");

      await deleteOwnAccount("target");

      expect(revokeAtBankMock).toHaveBeenCalledTimes(1);
      expect(revokeAtBankMock).toHaveBeenCalledWith("psd2_enablebanking", "session-1");
    });

    it("counts a consent the bank would not end, and one it had already ended as ended", async () => {
      txMock.bankConnection.findMany.mockResolvedValue([
        connection("psd2_enablebanking", "a"),
        connection("psd2_enablebanking", "b"),
        connection("psd2_enablebanking", "c"),
      ]);
      txMock.$executeRaw.mockResolvedValue(1);
      revokeAtBankMock
        .mockResolvedValueOnce("already_gone")
        .mockResolvedValueOnce("failed")
        .mockResolvedValueOnce("provider_unavailable");

      expect(await deleteOwnAccount("target")).toEqual({ bankConsentsNotRevoked: 2 });
    });

    it("removes the account's stored files, after the account", async () => {
      txMock.$executeRaw.mockResolvedValue(1);

      await deleteOwnAccount("target");

      expect(removeUserDocumentsMock).toHaveBeenCalledWith("target");
      expect(removeUserDocumentsMock.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.$executeRaw.mock.invocationCallOrder[0],
      );
    });

    it("still answers that it is deleted when the files could not be removed", async () => {
      txMock.$executeRaw.mockResolvedValue(1);
      removeUserDocumentsMock.mockResolvedValue(false);

      await expect(deleteOwnAccount("target")).resolves.toEqual({ bankConsentsNotRevoked: 0 });
    });
  });
});
