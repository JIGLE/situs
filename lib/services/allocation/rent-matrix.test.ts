import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rent matrix reads each month's status as of now, not as stored. The stored status moves only
 * when money is allocated or reversed, so a month nobody paid kept the "upcoming" it was created
 * with, and the matrix showed a debt as not yet due. The month sheet's figures, payments and "an
 * older month is still owed" note come from the same place.
 *
 * Prisma is mocked: this pins what the read model makes of the rows, and that every query is
 * scoped to the caller.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    rentPeriod: { findMany: vi.fn() },
    lease: { findFirst: vi.fn() },
    paymentAllocation: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { getRentMatrix, getRentMonth, periodStatusAt } from "./rent-matrix";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const due = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));

function period(
  lease: { id: string; tenant: string; property: string },
  month: number,
  figures: { status: string; dueAmount?: number; allocatedAmount?: number; paidAt?: Date | null },
) {
  return {
    leaseId: lease.id,
    tenantId: `tenant-${lease.id}`,
    propertyId: `property-${lease.id}`,
    month,
    status: figures.status,
    dueDate: due(2026, month),
    dueAmount: figures.dueAmount ?? 800,
    allocatedAmount: figures.allocatedAmount ?? 0,
    paidAt: figures.paidAt ?? null,
    tenant: { name: lease.tenant },
    property: { name: lease.property },
    lease: { status: "active" },
  };
}

const ZE = { id: "lease-ze", tenant: "Zé Pereira", property: "Rua do Ouro 3" };
const ALVARO = { id: "lease-alvaro", tenant: "Álvaro Lopes", property: "Rua Augusta 12" };

describe("periodStatusAt", () => {
  const figures = { dueDate: due(2026, 8), dueAmount: 800, allocatedAmount: 0, paidAt: null };

  it("reads an unpaid month that fell due weeks ago as overdue, whatever was stored", () => {
    expect(periodStatusAt({ ...figures, status: "upcoming" }, NOW)).toBe("overdue");
  });

  it("reads a month due tomorrow as upcoming", () => {
    expect(periodStatusAt({ ...figures, dueDate: due(2026, 10), status: "upcoming" }, NOW)).toBe(
      "upcoming",
    );
  });

  it("keeps a waived month waived: that is a decision, not a date", () => {
    expect(periodStatusAt({ ...figures, status: "waived" }, NOW)).toBe("waived");
  });
});

describe("getRentMatrix", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the caller's periods for the year only", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([]);

    await getRentMatrix("user-1", 2026, NOW);

    expect(prismaMock.rentPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", year: 2026 } }),
    );
  });

  it("shows a past month nobody paid as overdue although its stored status is upcoming", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([period(ZE, 8, { status: "upcoming" })]);

    const matrix = await getRentMatrix("user-1", 2026, NOW);

    expect(matrix.rows[0].months[8]).toEqual({
      status: "overdue",
      dueAmount: 800,
      allocatedAmount: 0,
      outstanding: 800,
    });
  });

  it("gives each month what it still owes, and nothing once it is paid", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      period(ZE, 7, { status: "paid", allocatedAmount: 800, paidAt: due(2026, 7) }),
      period(ZE, 8, { status: "partially_paid", allocatedAmount: 500.1 }),
    ]);

    const [row] = (await getRentMatrix("user-1", 2026, NOW)).rows;

    expect(row.months[7]).toMatchObject({ status: "paid", outstanding: 0 });
    expect(row.months[8]).toMatchObject({ status: "partially_paid", outstanding: 299.9 });
  });

  it("sorts rows by tenant as Portuguese does, accents and all", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      period(ZE, 1, { status: "paid", allocatedAmount: 800 }),
      period(ALVARO, 1, { status: "paid", allocatedAmount: 800 }),
    ]);

    const matrix = await getRentMatrix("user-1", 2026, NOW);

    // By code point, "Á" sorts after "Z".
    expect(matrix.rows.map((row) => row.tenantName)).toEqual(["Álvaro Lopes", "Zé Pereira"]);
  });

  it("names the tenant, the property and the lease's status on each row", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([period(ALVARO, 3, { status: "upcoming" })]);

    const [row] = (await getRentMatrix("user-1", 2026, NOW)).rows;

    expect(row).toMatchObject({
      leaseId: "lease-alvaro",
      tenantId: "tenant-lease-alvaro",
      propertyId: "property-lease-alvaro",
      tenantName: "Álvaro Lopes",
      propertyName: "Rua Augusta 12",
      leaseStatus: "active",
    });
  });

  it("adds up what was expected and received per row, per month and for the year", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      period(ZE, 7, { status: "paid", allocatedAmount: 800 }),
      period(ZE, 8, { status: "partially_paid", allocatedAmount: 300.1 }),
      period(ALVARO, 7, { status: "paid", dueAmount: 650.2, allocatedAmount: 650.2 }),
      period(ALVARO, 8, { status: "upcoming", dueAmount: 650.2 }),
    ]);

    const matrix = await getRentMatrix("user-1", 2026, NOW);

    const [alvaro, ze] = matrix.rows;
    expect(ze.totals).toEqual({ expected: 1600, received: 1100.1 });
    expect(alvaro.totals).toEqual({ expected: 1300.4, received: 650.2 });
    expect(matrix.totals.months[7]).toEqual({ expected: 1450.2, received: 1450.2 });
    expect(matrix.totals.months[8]).toEqual({ expected: 1450.2, received: 300.1 });
    expect(matrix.totals.months[9]).toBeUndefined();
    expect(matrix.totals.expected).toBe(2900.4);
    expect(matrix.totals.received).toBe(1750.3);
  });

  it("leaves a waived month out of every total and owes nothing for it", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      period(ZE, 7, { status: "paid", allocatedAmount: 800 }),
      period(ZE, 8, { status: "waived" }),
    ]);

    const matrix = await getRentMatrix("user-1", 2026, NOW);

    expect(matrix.rows[0].months[8]).toMatchObject({ status: "waived", outstanding: 0 });
    expect(matrix.rows[0].totals).toEqual({ expected: 800, received: 800 });
    expect(matrix.totals.months[8]).toEqual({ expected: 0, received: 0 });
    expect(matrix.totals.expected).toBe(800);
  });
});

describe("getRentMonth", () => {
  const lease = {
    id: "lease-ze",
    tenantId: "tenant-ze",
    propertyId: "property-ze",
    status: "active",
    monthlyRent: 800,
    tenant: { name: "Zé Pereira" },
    property: { name: "Rua do Ouro 3" },
  };
  const month = (year: number, m: number, figures: Record<string, unknown>) => ({
    id: `period-${year}-${m}`,
    year,
    month: m,
    status: "upcoming",
    dueDate: due(year, m),
    dueAmount: 800,
    allocatedAmount: 0,
    paidAt: null,
    ...figures,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.lease.findFirst.mockResolvedValue(lease);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([]);
  });

  it("is null for a lease that is not the caller's, and reads nothing else", async () => {
    prismaMock.lease.findFirst.mockResolvedValue(null);

    expect(await getRentMonth("user-2", "lease-ze", 2026, 8, NOW)).toBeNull();
    expect(prismaMock.lease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lease-ze", userId: "user-2" } }),
    );
    expect(prismaMock.rentPeriod.findMany).not.toHaveBeenCalled();
    expect(prismaMock.paymentAllocation.findMany).not.toHaveBeenCalled();
  });

  it("gives the month's figures with its status as of now", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      month(2026, 8, { status: "upcoming", allocatedAmount: 200 }),
    ]);

    const result = await getRentMonth("user-1", "lease-ze", 2026, 8, NOW);

    expect(result?.lease).toEqual({
      id: "lease-ze",
      tenantId: "tenant-ze",
      propertyId: "property-ze",
      tenantName: "Zé Pereira",
      propertyName: "Rua do Ouro 3",
      status: "active",
      monthlyRent: 800,
    });
    expect(result?.period).toEqual({
      year: 2026,
      month: 8,
      status: "partially_paid",
      dueDate: "2026-08-01T00:00:00.000Z",
      dueAmount: 800,
      allocatedAmount: 200,
      outstanding: 600,
      paidAt: null,
    });
  });

  it("lists the live payments that paid it, each with its receipt's stage", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      month(2026, 8, { status: "paid", allocatedAmount: 800, paidAt: due(2026, 8) }),
    ]);
    prismaMock.paymentAllocation.findMany.mockResolvedValue([
      {
        amount: 800,
        allocatedAt: new Date("2026-08-02T09:30:00.000Z"),
        receipt: {
          id: "receipt-1",
          date: new Date("2026-08-01T00:00:00.000Z"),
          amount: 800,
          lifecycle: "emitted",
          source: "automation",
        },
      },
    ]);

    const result = await getRentMonth("user-1", "lease-ze", 2026, 8, NOW);

    expect(prismaMock.paymentAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rentPeriodId: "period-2026-8", userId: "user-1", reversedAt: null },
      }),
    );
    expect(result?.payments).toEqual([
      {
        amount: 800,
        allocatedAt: "2026-08-02T09:30:00.000Z",
        receipt: {
          id: "receipt-1",
          date: "2026-08-01",
          amount: 800,
          lifecycle: "emitted",
          source: "automation",
        },
      },
    ]);
  });

  it("names the oldest earlier month still owed, since a new payment fills that one first", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      month(2025, 12, { status: "paid", allocatedAmount: 800 }),
      month(2026, 6, { status: "partially_paid", allocatedAmount: 500 }),
      month(2026, 7, { status: "upcoming" }),
      month(2026, 8, { status: "upcoming" }),
    ]);

    const result = await getRentMonth("user-1", "lease-ze", 2026, 8, NOW);

    expect(result?.olderUnpaid).toEqual({ year: 2026, month: 6 });
  });

  it("names no older month when every earlier one is paid or waived", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      month(2026, 6, { status: "paid", allocatedAmount: 800 }),
      month(2026, 7, { status: "waived" }),
      month(2026, 8, { status: "upcoming" }),
    ]);

    const result = await getRentMonth("user-1", "lease-ze", 2026, 8, NOW);

    expect(result?.olderUnpaid).toBeNull();
  });

  it("reads only the caller's periods up to the month asked for", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([]);

    await getRentMonth("user-1", "lease-ze", 2026, 8, NOW);

    expect(prismaMock.rentPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          leaseId: "lease-ze",
          userId: "user-1",
          OR: [{ year: { lt: 2026 } }, { year: 2026, month: { lte: 8 } }],
        },
      }),
    );
  });

  it("has no period and no payments for a month the lease has none for", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([month(2026, 6, { status: "upcoming" })]);

    const result = await getRentMonth("user-1", "lease-ze", 2026, 8, NOW);

    expect(result?.period).toBeNull();
    expect(result?.payments).toEqual([]);
    expect(prismaMock.paymentAllocation.findMany).not.toHaveBeenCalled();
    // An earlier month the lease still owes is named all the same.
    expect(result?.olderUnpaid).toEqual({ year: 2026, month: 6 });
  });
});
