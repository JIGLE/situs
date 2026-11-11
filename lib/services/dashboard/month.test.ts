import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, atMock, attentionMock } = vi.hoisted(() => ({
  prismaMock: {
    rentPeriod: { findMany: vi.fn() },
    lease: { count: vi.fn() },
    bankConnection: { findMany: vi.fn() },
  },
  atMock: vi.fn(),
  attentionMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/tax/at-connection", () => ({ getAtConnection: atMock }));
vi.mock("@/lib/services/attention/gather", () => ({ getAttention: attentionMock }));

import { getDashboardMonth } from "./month";

const NOW = new Date("2026-09-27T12:00:00.000Z");

/** A month of the ledger as the read model selects it. */
function period({
  due = 750,
  allocated = 0,
  dueDate = "2026-08-01T00:00:00.000Z",
  paidAt = null as string | null,
  stored = "upcoming",
} = {}) {
  return {
    status: stored,
    dueDate: new Date(dueDate),
    dueAmount: due,
    allocatedAmount: allocated,
    paidAt: paidAt ? new Date(paidAt) : null,
  };
}

/** A month still owed, with the tenancy it belongs to. */
function owedMonth(dueAmount: number, allocatedAmount: number, lease = "lease-1") {
  const names: Record<string, [string, string]> = {
    "lease-1": ["Ana Martínez", "Rua Augusta 12"],
    "lease-2": ["Carlos Gómez", "Rua do Ouro 3"],
  };
  const [tenant, property] = names[lease];
  return {
    dueAmount,
    allocatedAmount,
    lease: { id: lease, tenant: { name: tenant }, property: { name: property } },
  };
}

const PAID = { allocated: 750, paidAt: "2026-08-02T00:00:00.000Z", stored: "paid" };

let monthPeriods: ReturnType<typeof period>[];
let owedPeriods: ReturnType<typeof owedMonth>[];

beforeEach(() => {
  vi.clearAllMocks();
  monthPeriods = [];
  owedPeriods = [];
  // The month's periods carry a year; the months still owed do not.
  prismaMock.rentPeriod.findMany.mockImplementation(async (args: { where: { year?: number } }) =>
    args.where.year === undefined ? owedPeriods : monthPeriods,
  );
  prismaMock.lease.count.mockResolvedValue(0);
  prismaMock.bankConnection.findMany.mockResolvedValue([]);
  atMock.mockResolvedValue({ mode: "sandbox" });
  attentionMock.mockResolvedValue({ items: [], counts: { total: 0 } });
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

  it("reads what arrived from the money allocated, whatever status was stored", async () => {
    monthPeriods = [period({ stored: "paid" }), period({ ...PAID, stored: "upcoming" })];

    const month = await getDashboardMonth("user-1", 2026, 8, NOW);

    expect(month.figures).toEqual({ expected: 1500, received: 750, outstanding: 750 });
  });
});

describe("getDashboardMonth — who is late", () => {
  it("lists each tenancy still owing, with its months and balance, most owed first", async () => {
    owedPeriods = [
      owedMonth(750, 0),
      owedMonth(500, 200, "lease-2"),
      owedMonth(750, 0),
      // Paid within a cent: nothing is owed.
      owedMonth(500, 499.999, "lease-2"),
    ];

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.late).toEqual([
      {
        leaseId: "lease-1",
        tenantName: "Ana Martínez",
        propertyName: "Rua Augusta 12",
        months: 2,
        amount: 1500,
      },
      {
        leaseId: "lease-2",
        tenantName: "Carlos Gómez",
        propertyName: "Rua do Ouro 3",
        months: 1,
        amount: 300,
      },
    ]);
  });

  it("is empty when nobody owes anything", async () => {
    expect((await getDashboardMonth("user-1", 2026, 9, NOW)).late).toEqual([]);
  });
});

describe("getDashboardMonth — what waits", () => {
  it("counts what waits, whichever month is shown", async () => {
    prismaMock.lease.count.mockResolvedValue(1);

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.attention).toEqual({ leasesEnding: 1, missingData: 0 });
    expect(prismaMock.rentPeriod.findMany.mock.calls[1][0].where).toEqual({
      userId: "user-1",
      status: { not: "waived" },
      paidAt: null,
      dueDate: { lt: NOW },
    });
    expect(prismaMock.lease.count.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      status: "active",
      endDate: { gt: NOW, lte: new Date("2026-11-26T12:00:00.000Z") },
    });
  });

  it("counts what a receipt still needs from the owner, from the owner's own list", async () => {
    attentionMock.mockResolvedValue({ items: [], counts: { total: 3 } });

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.attention.missingData).toBe(3);
    expect(attentionMock).toHaveBeenCalledWith("user-1");
  });
});

describe("getDashboardMonth — the status line", () => {
  it("says no bank is connected", async () => {
    expect((await getDashboardMonth("user-1", 2026, 9, NOW)).status.bank).toBeNull();
  });

  it("gives the last sync and the consent that ends first", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      {
        status: "active",
        lastSyncAt: new Date("2026-09-26T08:00:00.000Z"),
        consentExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
      },
      {
        status: "active",
        lastSyncAt: new Date("2026-09-27T08:00:00.000Z"),
        consentExpiresAt: new Date("2026-10-15T00:00:00.000Z"),
      },
    ]);

    expect((await getDashboardMonth("user-1", 2026, 9, NOW)).status.bank).toEqual({
      lastSyncAt: "2026-09-27T08:00:00.000Z",
      consentEndsAt: "2026-10-15T00:00:00.000Z",
      expired: false,
    });
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

  it("passes the Finanças mode through", async () => {
    atMock.mockResolvedValue({ mode: "test" });

    const month = await getDashboardMonth("user-1", 2026, 9, NOW);

    expect(month.status.taxMode).toBe("test");
    expect(atMock).toHaveBeenCalledWith("user-1");
  });

  it("reads nothing but the owner's own records", async () => {
    await getDashboardMonth("user-1", 2026, 9, NOW);

    const wheres = [
      ...prismaMock.rentPeriod.findMany.mock.calls,
      ...prismaMock.lease.count.mock.calls,
      ...prismaMock.bankConnection.findMany.mock.calls,
    ].map((call) => call[0].where);
    expect(wheres.length).toBeGreaterThan(0);
    for (const where of wheres) expect(where.userId).toBe("user-1");
  });
});
