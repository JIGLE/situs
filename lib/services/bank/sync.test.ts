import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, importMock, providerMock } = vi.hoisted(() => ({
  prismaMock: {
    bankConnection: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    bankSyncJob: { count: vi.fn() },
  },
  importMock: vi.fn(),
  providerMock: { key: "fake", dailyReadBudget: 4, fetchTransactions: vi.fn() },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("./import", () => ({ importBankRows: importMock }));
vi.mock("./providers/registry", () => ({
  getProviderForConnection: (column: string) =>
    column.startsWith("psd2_") ? providerMock : undefined,
}));

import {
  syncConnection,
  syncAllDueConnections,
  remainingBudget,
  SyncBudgetExceededError,
  ConnectionNotSyncableError,
} from "./sync";

/** The fake provider's own budget. It is a provider term, not a global constant. */
const BUDGET = 4;
import { ConsentExpiredError } from "./providers/types";

const NOW = new Date("2026-08-14T10:00:00.000Z");

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "psd2_fake",
    institutionName: "Banco BPI",
    status: "active",
    lastSyncAt: null,
    metadata: JSON.stringify({ accountRefs: { "acct-1": "remote-account-1" } }),
    accounts: [{ id: "acct-1", label: "Conta ordenado", isActive: true }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankSyncJob.count.mockResolvedValue(0);
  prismaMock.bankConnection.findFirst.mockResolvedValue(connection());
  prismaMock.bankConnection.update.mockResolvedValue({});
  providerMock.fetchTransactions.mockResolvedValue([]);
  importMock.mockResolvedValue({
    jobId: "job-1",
    imported: 0,
    duplicates: 0,
    autoMatched: 0,
    needsReview: 0,
    errors: [],
  });
});

/**
 * Providers cap reads per day and answer 429 for the remainder of the day once that is passed —
 * the penalty outlasts the mistake, so the cap is enforced before a call is spent rather than
 * discovered from the provider. The number belongs to the provider, not to `sync.ts`.
 */
describe("daily budget", () => {
  it("refuses once the day's reads are spent, and says when they return", async () => {
    prismaMock.bankSyncJob.count.mockResolvedValue(BUDGET);

    const error = await syncConnection("user-1", "conn-1", NOW).catch((e) => e);
    expect(error).toBeInstanceOf(SyncBudgetExceededError);
    expect(error.resetAt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(providerMock.fetchTransactions).not.toHaveBeenCalled();
  });

  it("allows the last read of the day and reports none remaining", async () => {
    prismaMock.bankSyncJob.count.mockResolvedValue(BUDGET - 1);

    const result = await syncConnection("user-1", "conn-1", NOW);
    expect(result.remainingBudget).toBe(0);
  });

  it("counts a run that found nothing", async () => {
    // Otherwise someone waiting on a payment could press Sync now indefinitely: the provider call
    // is spent either way, and only the job row records that it happened.
    providerMock.fetchTransactions.mockResolvedValue([]);

    await syncConnection("user-1", "conn-1", NOW);
    expect(importMock).toHaveBeenCalledTimes(1);
  });

  it("reads the budget from persisted jobs, not memory", async () => {
    prismaMock.bankSyncJob.count.mockResolvedValue(1);
    expect(await remainingBudget("conn-1", "psd2_fake", NOW)).toBe(BUDGET - 1);
  });
});

describe("targeting", () => {
  it("attributes rows to the provider connection and account", async () => {
    providerMock.fetchTransactions.mockResolvedValue([{ bookingDate: "2026-08-01", amount: 750 }]);

    await syncConnection("user-1", "conn-1", NOW);

    expect(importMock).toHaveBeenCalledWith(
      "user-1",
      [{ bookingDate: "2026-08-01", amount: 750 }],
      "api_sync",
      { connectionId: "conn-1", bankAccountId: "acct-1" },
    );
  });

  it("re-requests a few days of overlap so late-booked movements are not lost", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(
      connection({ lastSyncAt: new Date("2026-08-14T09:00:00.000Z") }),
    );

    await syncConnection("user-1", "conn-1", NOW);

    const since = providerMock.fetchTransactions.mock.calls[0][1] as Date;
    expect(since.toISOString()).toBe("2026-08-11T09:00:00.000Z");
  });

  it("asks for full history on a first sync", async () => {
    await syncConnection("user-1", "conn-1", NOW);
    expect(providerMock.fetchTransactions.mock.calls[0][1]).toBeUndefined();
  });
});

describe("refusals", () => {
  it("scopes the lookup by userId so another owner's connection cannot be reached", async () => {
    // Asserted on the query, not on a null mock: a handler that fetched by id and compared
    // afterwards would pass a null-returning stub while still being an IDOR.
    await syncConnection("user-1", "conn-1", NOW);

    expect(prismaMock.bankConnection.findFirst.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      userId: "user-1",
    });
  });

  it("treats a connection it cannot find as unsyncable", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(null);

    await expect(syncConnection("user-2", "conn-1", NOW)).rejects.toBeInstanceOf(
      ConnectionNotSyncableError,
    );
  });

  it("refuses a manual/CSV connection", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(connection({ provider: "manual" }));

    await expect(syncConnection("user-1", "conn-1", NOW)).rejects.toThrow(/cannot be synced/i);
  });

  it("refuses an expired connection and points at reconnecting", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(connection({ status: "expired" }));

    await expect(syncConnection("user-1", "conn-1", NOW)).rejects.toThrow(/reconnect/i);
  });
});

describe("expired consent", () => {
  it("marks the connection expired instead of recording a quiet empty sync", async () => {
    // Reporting this as "0 new movements" would turn an indefinite outage into a success.
    providerMock.fetchTransactions.mockRejectedValue(new ConsentExpiredError());

    await expect(syncConnection("user-1", "conn-1", NOW)).rejects.toBeInstanceOf(
      ConsentExpiredError,
    );
    expect(prismaMock.bankConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { status: "expired" },
    });
  });
});

describe("scheduled run", () => {
  it("isolates failures so one dead consent does not stop the estate", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      { id: "conn-1", userId: "user-1" },
      { id: "conn-2", userId: "user-2" },
      { id: "conn-3", userId: "user-3" },
    ]);
    prismaMock.bankConnection.findFirst
      .mockResolvedValueOnce(connection())
      .mockResolvedValueOnce(connection({ id: "conn-2", userId: "user-2" }))
      .mockResolvedValueOnce(connection({ id: "conn-3", userId: "user-3" }));
    providerMock.fetchTransactions
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ConsentExpiredError())
      .mockResolvedValueOnce([]);

    const report = await syncAllDueConnections(NOW);

    expect(report).toEqual({ attempted: 3, succeeded: 2, failed: 0, expired: 1 });
  });

  it("only picks up provider connections not yet synced today", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([]);

    await syncAllDueConnections(NOW);

    const where = prismaMock.bankConnection.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("active");
    expect(where.provider).toEqual({ startsWith: "psd2_" });
    expect(where.OR).toEqual([
      { lastSyncAt: null },
      { lastSyncAt: { lt: new Date("2026-08-14T00:00:00.000Z") } },
    ]);
  });
});

/**
 * `consentExpiresAt` was written at consent time and enforced by nothing. Expiry was learned
 * only when the provider rejected a call — which spends a read to discover something the row
 * already knew, and (because the budget is counted from the job rows a SUCCESSFUL import
 * writes) is not counted against the budget at all.
 */
describe("consent expiry", () => {
  it("refuses before spending a provider read once the consent has lapsed", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(
      connection({ consentExpiresAt: new Date("2026-08-13T10:00:00.000Z") }),
    );

    await expect(syncConnection("user-1", "conn-1", NOW)).rejects.toBeInstanceOf(
      ConsentExpiredError,
    );

    // The point of the whole change: the provider is never called.
    expect(providerMock.fetchTransactions).not.toHaveBeenCalled();
  });

  it("marks the connection expired so the next attempt is refused by status alone", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(
      connection({ consentExpiresAt: new Date("2026-08-13T10:00:00.000Z") }),
    );

    await expect(syncConnection("user-1", "conn-1", NOW)).rejects.toThrow();

    expect(prismaMock.bankConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { status: "expired" },
    });
  });

  it("syncs normally while the consent is still valid", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(
      connection({ consentExpiresAt: new Date("2026-09-13T10:00:00.000Z") }),
    );

    await expect(syncConnection("user-1", "conn-1", NOW)).resolves.toMatchObject({
      connectionId: "conn-1",
    });
    expect(providerMock.fetchTransactions).toHaveBeenCalled();
  });

  it("syncs when no expiry was ever recorded, rather than treating null as expired", async () => {
    // Connections created before the provider returned an expiry have null here. Reading that
    // as "expired" would switch the feature off for every one of them.
    prismaMock.bankConnection.findFirst.mockResolvedValue(connection({ consentExpiresAt: null }));

    await expect(syncConnection("user-1", "conn-1", NOW)).resolves.toMatchObject({
      connectionId: "conn-1",
    });
    expect(providerMock.fetchTransactions).toHaveBeenCalled();
  });

  it("treats an expiry exactly at now as expired", async () => {
    prismaMock.bankConnection.findFirst.mockResolvedValue(connection({ consentExpiresAt: NOW }));

    await expect(syncConnection("user-1", "conn-1", NOW)).rejects.toBeInstanceOf(
      ConsentExpiredError,
    );
  });
});
