import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, atMock } = vi.hoisted(() => ({
  prismaMock: {
    rentPeriod: { findMany: vi.fn() },
    bankTransaction: { count: vi.fn(), findMany: vi.fn() },
    receipt: { count: vi.fn(), findMany: vi.fn() },
    lease: { count: vi.fn() },
    property: { count: vi.fn() },
    bankConnection: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
  atMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/tax/at-connection", () => ({ getAtConnection: atMock }));

import { getDashboardMonth } from "./month";

const NOW = new Date("2026-09-27T12:00:00.000Z");

/** A month of the ledger as the read model selects it. */
function period({
  due = 750,
  allocated = 0,
  dueDate = "2026-08-01T00:00:00.000Z",
  paidAt = null as string | null,
  stored = "upcoming",
  receipts = [] as { lifecycle: string; movements?: string[] }[],
  filings = [] as string[],
} = {}) {
  return {
    status: stored,
    dueDate: new Date(dueDate),
    dueAmount: due,
    allocatedAmount: allocated,
    paidAt: paidAt ? new Date(paidAt) : null,
    allocations: receipts.map((receipt) => ({
      receipt: {
        lifecycle: receipt.lifecycle,
        bankTransactions: (receipt.movements ?? []).map((status) => ({ status })),
      },
    })),
    rentReceiptFilings: filings.map((status) => ({ status })),
  };
}

const PAID = { allocated: 750, paidAt: "2026-08-02T00:00:00.000Z", stored: "paid" };

let monthPeriods: ReturnType<typeof period>[];
let owedPeriods: { dueAmount: number; allocatedAmount: number }[];

beforeEach(() => {
  vi.clearAllMocks();
  monthPeriods = [];
  owedPeriods = [];
  // The month's periods carry a year; the months still owed do not.
  prismaMock.rentPeriod.findMany.mockImplementation(async (args: { where: { year?: number } }) =>
    args.where.year === undefined ? owedPeriods : monthPeriods,
  );
  prismaMock.bankTransaction.count.mockResolvedValue(0);
  prismaMock.bankTransaction.findMany.mockResolvedValue([]);
  prismaMock.receipt.count.mockResolvedValue(0);
  prismaMock.receipt.findMany.mockResolvedValue([]);
  prismaMock.lease.count.mockResolvedValue(0);
  prismaMock.property.count.mockImplementation(async (args: { where: { status?: string } }) =>
    args.where.status ? 7 : 8,
  );
  prismaMock.bankConnection.findMany.mockResolvedValue([]);
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  atMock.mockResolvedValue({ mode: "sandbox" });
});

describe("getDashboardMonth — the figures", () => {
  it("adds up the month from the ledger, an unpaid past month owed in full", async () => {
    monthPeriods = [
      period(PAID),
      // Never paid, and its stored status never moved from "upcoming": still owed in full.
      period({ due: 600 }),
      period({ due: 500, allocated: 200, stored: "partially_paid" }),
    ];

    const month = await getDashboardMonth("user-1", 2026, 8, NOW);

    expect(month.figures).toEqual({ expected: 1850, received: 950, outstanding: 900 });
    // Waived months are left out at the query.
    expect(prismaMock.rentPeriod.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      year: 2026,
      month: 8,
      status: { not: "waived" },
    });
  });

  it("counts a month paid only when the ledger says so today, whatever it stored", async () => {
    monthPeriods = [
      // Stored as paid, but nothing is allocated to it: it is owed.
      period({ stored: "paid" }),
      // Stored as upcoming, and fully paid: they count.
      period({ ...PAID, stored: "upcoming" }),
      period({ ...PAID, stored: "due" }),
    ];

    const month = await getDashboardMonth("user-1", 2026, 8, NOW);

    expect(month.loop.paid).toBe(2);
  });
});

describe("getDashboardMonth — the loop", () => {
  it("follows each rent through payment, reconciliation, receipt and Finanças", async () => {
    monthPeriods = [
      // All the way through.
      period({
        ...PAID,
        receipts: [{ lifecycle: "accepted", movements: ["matched_confirmed"] }],
        filings: ["accepted"],
      }),
      // Matched by the engine and issued, not filed.
      period({ ...PAID, receipts: [{ lifecycle: "emitted", movements: ["auto_matched"] }] }),
      // Paid by hand: issued, with no bank movement behind it.
      period({ ...PAID, receipts: [{ lifecycle: "emitted" }] }),
      // Matched, with its receipt still a draft.
      period({ ...PAID, receipts: [{ lifecycle: "draft", movements: ["matched_confirmed"] }] }),
      // A movement still waiting in the inbox does not reconcile anything.
      period({ ...PAID, receipts: [{ lifecycle: "review", movements: ["needs_review"] }] }),
      // Not paid at all.
      period(),
    ];

    const month = await getDashboardMonth("user-1", 2026, 8, NOW);

    expect(month.loop).toEqual({
      rents: 6,
      paid: 5,
      reconciled: 3,
      receiptsIssued: 3,
      receiptsToIssue: 2,
      filed: 1,
      fullyProcessed: 1,
    });
  });

  it("does not count a filing that never reached Finanças", async () => {
    monthPeriods = [
      period({
        ...PAID,
        receipts: [{ lifecycle: "emitted", movements: ["matched_confirmed"] }],
        filings: ["draft", "rejected"],
      }),
    ];

    const month = await getDashboardMonth("user-1", 2026, 8, NOW);

    expect(month.loop.filed).toBe(0);
    expect(month.loop.fullyProcessed).toBe(0);
  });
});

describe("getDashboardMonth — what waits", () => {
  it("lists every month still owed, whichever month is shown", async () => {
    owedPeriods = [
      { dueAmount: 750, allocatedAmount: 0 },
      { dueAmount: 500, allocatedAmount: 200 },
      // Paid within a cent: nothing is owed.
      { dueAmount: 500, allocatedAmount: 499.999 },
    ];
    prismaMock.bankTransaction.count.mockResolvedValue(3);
    prismaMock.receipt.count.mockResolvedValue(2);
    prismaMock.lease.count.mockResolvedValue(1);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.attention).toEqual({
      monthsOwed: { count: 2, amount: 1050 },
      movementsToReview: 3,
      receiptsInDraft: 2,
      leasesEnding: 1,
    });
    expect(prismaMock.rentPeriod.findMany.mock.calls[1][0].where).toEqual({
      userId: "user-1",
      status: { not: "waived" },
      paidAt: null,
      dueDate: { lt: NOW },
    });
    // Money in only: money going out is never work.
    expect(prismaMock.bankTransaction.count.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      status: "needs_review",
      amount: { gt: 0 },
    });
    expect(prismaMock.lease.count.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      status: "active",
      endDate: { gt: NOW, lte: new Date("2026-11-26T12:00:00.000Z") },
    });
  });

  it("gives the portfolio as counts", async () => {
    prismaMock.lease.count.mockResolvedValue(2);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.portfolio).toEqual({ properties: 8, occupied: 7, leasesEnding: 2 });
  });
});

describe("getDashboardMonth — the status line and recent money", () => {
  it("shows the last bank movements when a bank is connected, marking what waits", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      {
        status: "active",
        lastSyncAt: new Date("2026-09-26T06:00:00.000Z"),
        consentExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
      },
      {
        status: "active",
        lastSyncAt: new Date("2026-09-27T06:00:00.000Z"),
        consentExpiresAt: new Date("2026-10-05T00:00:00.000Z"),
      },
    ]);
    prismaMock.bankTransaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        bookingDate: new Date("2026-09-26T00:00:00.000Z"),
        amount: 750,
        currency: "EUR",
        counterpartyName: "Ana Silva",
        status: "needs_review",
      },
      {
        id: "tx-2",
        bookingDate: new Date("2026-09-25T00:00:00.000Z"),
        amount: 600,
        currency: "EUR",
        counterpartyName: null,
        status: "auto_matched",
      },
    ]);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    // The latest sync, and the consent that ends first.
    expect(month.status.bank).toEqual({
      lastSyncAt: "2026-09-27T06:00:00.000Z",
      consentEndsAt: "2026-10-05T00:00:00.000Z",
      expired: false,
    });
    expect(month.recent).toEqual({
      source: "bank",
      items: [
        {
          id: "tx-1",
          date: "2026-09-26T00:00:00.000Z",
          amount: 750,
          currency: "EUR",
          counterparty: "Ana Silva",
          state: "review",
        },
        {
          id: "tx-2",
          date: "2026-09-25T00:00:00.000Z",
          amount: 600,
          currency: "EUR",
          counterparty: null,
          state: "processed",
        },
      ],
    });
    expect(prismaMock.receipt.findMany).not.toHaveBeenCalled();
    // A disconnected connection is not a connected bank.
    expect(prismaMock.bankConnection.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      provider: { startsWith: "psd2_" },
      status: { not: "revoked" },
    });
  });

  it("never marks money going out for review, as the inbox never counts it as work", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      { status: "active", lastSyncAt: null, consentExpiresAt: null },
    ]);
    prismaMock.bankTransaction.findMany.mockResolvedValue([
      {
        id: "tx-3",
        bookingDate: new Date("2026-09-24T00:00:00.000Z"),
        amount: -120.5,
        currency: "EUR",
        counterpartyName: "EDP Comercial",
        status: "needs_review",
      },
    ]);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.recent.source === "bank" && month.recent.items[0].state).toBe("outgoing");
  });

  it("shows the last payments instead when no bank is connected", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([
      {
        id: "rec-1",
        date: new Date("2026-09-02T00:00:00.000Z"),
        amount: 750,
        tenant: { name: "Ana Silva" },
      },
    ]);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.status.bank).toBeNull();
    expect(month.recent).toEqual({
      source: "payments",
      items: [
        { id: "rec-1", date: "2026-09-02T00:00:00.000Z", amount: 750, tenantName: "Ana Silva" },
      ],
    });
    expect(prismaMock.receipt.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      status: "paid",
    });
    expect(prismaMock.bankTransaction.findMany).not.toHaveBeenCalled();
  });

  it("says a consent has ended, by its status or its date", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      {
        status: "active",
        lastSyncAt: null,
        consentExpiresAt: new Date("2026-09-20T00:00:00.000Z"),
      },
    ]);
    expect((await getDashboardMonth("user-1", 2026, 9, NOW)).status.bank?.expired).toBe(true);

    prismaMock.bankConnection.findMany.mockResolvedValue([
      { status: "expired", lastSyncAt: null, consentExpiresAt: null },
    ]);
    expect((await getDashboardMonth("user-1", 2026, 9, NOW)).status.bank).toEqual({
      lastSyncAt: null,
      consentEndsAt: null,
      expired: true,
    });
  });

  it("passes the Finanças mode through, and the last audit entries", async () => {
    atMock.mockResolvedValue({ mode: "test" });
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        action: "RECEIPT_EMITTED",
        resourceType: "receipt",
        createdAt: new Date("2026-09-27T10:00:00.000Z"),
      },
    ]);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.status.taxMode).toBe("test");
    expect(atMock).toHaveBeenCalledWith("user-1");
    expect(month.activity).toEqual([
      {
        id: "log-1",
        action: "RECEIPT_EMITTED",
        resourceType: "receipt",
        createdAt: "2026-09-27T10:00:00.000Z",
      },
    ]);
    expect(prismaMock.auditLog.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("reads nothing but the owner's own records", async () => {
    await getDashboardMonth("user-1", 2026, 9, NOW);

    const wheres = [
      ...prismaMock.rentPeriod.findMany.mock.calls,
      ...prismaMock.bankTransaction.count.mock.calls,
      ...prismaMock.receipt.count.mock.calls,
      ...prismaMock.receipt.findMany.mock.calls,
      ...prismaMock.lease.count.mock.calls,
      ...prismaMock.property.count.mock.calls,
      ...prismaMock.bankConnection.findMany.mock.calls,
      ...prismaMock.auditLog.findMany.mock.calls,
    ].map((call) => call[0].where);
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres) expect(where.userId).toBe("user-1");
  });
});
