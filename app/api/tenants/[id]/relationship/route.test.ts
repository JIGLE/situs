import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The relationship strip counted late months off `RentPeriod.status`, which is rewritten only when
 * money moves: a month nobody paid kept "upcoming" past its due date and was never counted. Its
 * status is read as of now (`periodStatusAt`), as every other screen reads it.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tenant: { findFirst: vi.fn() },
    lease: { findMany: vi.fn() },
    rentPeriod: { findMany: vi.fn() },
    receipt: { findMany: vi.fn() },
    bankTransaction: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { GET } from "./route";

const month = (m: number, over: Record<string, unknown> = {}) => ({
  id: `period-${m}`,
  year: 2026,
  month: m,
  status: "upcoming",
  dueDate: new Date(Date.UTC(2026, m - 1, 1)),
  dueAmount: 750,
  allocatedAmount: 0,
  paidAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
  prismaMock.lease.findMany.mockResolvedValue([{ id: "lease-1", status: "active" }]);
  prismaMock.receipt.findMany.mockResolvedValue([]);
  prismaMock.bankTransaction.findMany.mockResolvedValue([]);
});

async function read() {
  const res = await GET(
    new NextRequest("http://localhost:3000/api/tenants/tenant-1/relationship"),
    {
      params: Promise.resolve({ id: "tenant-1" }),
    },
  );
  return (await res.json()).data;
}

describe("GET /api/tenants/[id]/relationship", () => {
  it("counts a month nobody paid as late once its due date has passed, whatever it stored", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([
      month(1, { status: "paid", allocatedAmount: 750, paidAt: new Date("2026-01-01") }),
      month(2),
      month(3),
      month(4),
    ]);

    const data = await read();

    expect(data.periods.overdue).toBe(2);
    expect(data.periods.current).toEqual({ year: 2026, month: 2, status: "overdue" });
  });

  it("skips a waived month when it looks for the one still open", async () => {
    prismaMock.rentPeriod.findMany.mockResolvedValue([month(1, { status: "waived" }), month(4)]);

    const data = await read();

    expect(data.periods.overdue).toBe(0);
    expect(data.periods.current).toEqual({ year: 2026, month: 4, status: "upcoming" });
  });
});
