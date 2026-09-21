import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    auditLog: { deleteMany: vi.fn() },
    emailLog: { deleteMany: vi.fn() },
    notification: { deleteMany: vi.fn() },
    bankTransaction: { deleteMany: vi.fn() },
    bankSyncJob: { deleteMany: vi.fn() },
    bankConnection: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { runDataRetention, RETENTION_DAYS, ABANDONED_CONSENT_HOURS } from "./data-retention";

/** Pull the `where` a given model was deleted with. */
function whereFor(model: { deleteMany: ReturnType<typeof vi.fn> }): Record<string, unknown> {
  expect(model.deleteMany).toHaveBeenCalledTimes(1);
  return model.deleteMany.mock.calls[0][0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of [
    prismaMock.auditLog,
    prismaMock.emailLog,
    prismaMock.notification,
    prismaMock.bankTransaction,
    prismaMock.bankSyncJob,
    prismaMock.bankConnection,
  ]) {
    model.deleteMany.mockResolvedValue({ count: 0 });
  }
});

describe("bank movement retention", () => {
  /**
   * The safety property of the whole rule. A movement that became a Receipt is that receipt's
   * evidence — where the money came from — and PT/ES fiscal records outlive two years. Deleting
   * it on this schedule would leave receipts whose origin cannot be shown.
   */
  it("only deletes movements with no receipt link", async () => {
    await runDataRetention();
    expect(whereFor(prismaMock.bankTransaction)).toMatchObject({ receiptId: null });
  });

  it("cuts on bookingDate at the configured age", async () => {
    await runDataRetention();
    const where = whereFor(prismaMock.bankTransaction) as {
      bookingDate: { lt: Date };
    };

    const expectedDays = RETENTION_DAYS.unreconciledBankTransactions;
    const ageDays = (Date.now() - where.bookingDate.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThan(expectedDays - 1);
    expect(ageDays).toBeLessThan(expectedDays + 1);
  });

  it("never holds movements longer than the history a consent asks for", async () => {
    // The consent requests 730 days of history. Retaining beyond that would mean keeping data
    // we would not be permitted to fetch again.
    expect(RETENTION_DAYS.unreconciledBankTransactions).toBeLessThanOrEqual(730);
  });
});

describe("abandoned consent reaping", () => {
  /**
   * `startConsent` writes a live 256-bit reference into metadata and creates the row before
   * calling the provider, dropping the reference only on success. Every abandoned attempt left
   * a usable reference in the database with nothing to remove it.
   */
  it("deletes only connections still awaiting consent", async () => {
    await runDataRetention();
    expect(whereFor(prismaMock.bankConnection)).toMatchObject({ status: "pending_consent" });
  });

  it("refuses to delete one that has accounts, because the delete cascades", async () => {
    // A pending_consent row should never have accounts. "Should never" is not a guarantee, and
    // the failure mode is cascading away somebody's financial history.
    await runDataRetention();
    expect(whereFor(prismaMock.bankConnection)).toMatchObject({ accounts: { none: {} } });
  });

  it("leaves a flow that is only minutes old alone", async () => {
    await runDataRetention();
    const where = whereFor(prismaMock.bankConnection) as { createdAt: { lt: Date } };
    const ageHours = (Date.now() - where.createdAt.lt.getTime()) / (60 * 60 * 1000);

    expect(ageHours).toBeGreaterThan(ABANDONED_CONSENT_HOURS - 1);
    expect(ageHours).toBeLessThan(ABANDONED_CONSENT_HOURS + 1);
  });
});

describe("result reporting", () => {
  it("reports every category it deleted", async () => {
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.emailLog.deleteMany.mockResolvedValue({ count: 2 });
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 3 });
    prismaMock.bankTransaction.deleteMany.mockResolvedValue({ count: 4 });
    prismaMock.bankSyncJob.deleteMany.mockResolvedValue({ count: 5 });
    prismaMock.bankConnection.deleteMany.mockResolvedValue({ count: 6 });

    await expect(runDataRetention()).resolves.toMatchObject({
      auditLogsDeleted: 1,
      emailLogsDeleted: 2,
      notificationsDeleted: 3,
      bankTransactionsDeleted: 4,
      bankSyncJobsDeleted: 5,
      abandonedConsentsDeleted: 6,
    });
  });

  it("keeps audit logs longest, since they carry the legal obligation", async () => {
    expect(RETENTION_DAYS.auditLogs).toBeGreaterThan(RETENTION_DAYS.emailLogs);
    expect(RETENTION_DAYS.auditLogs).toBeGreaterThan(RETENTION_DAYS.unreconciledBankTransactions);
  });
});
