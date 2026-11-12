import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Finance › Owners' shares. The split itself is pure and covered in `split.test.ts`; these pin what the
 * routes add: every read is scoped to the caller, income is what counts as income (no deposit,
 * nothing voided) on the month it pays, and a payout is refused for another account's owner.
 */

const { requireOwnerAccessMock, logAuditMock, prismaMock } = vi.hoisted(() => ({
  requireOwnerAccessMock: vi.fn(),
  logAuditMock: vi.fn(),
  prismaMock: {
    propertyOwner: { findMany: vi.fn() },
    receipt: { findMany: vi.fn() },
    expense: { findMany: vi.fn() },
    owner: { findFirst: vi.fn() },
    ownerPayout: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: requireOwnerAccessMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const url = "http://localhost:3000/api/owner-payouts";

const post = (body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const receipt = (over: Record<string, unknown> = {}) => ({
  propertyId: "p1",
  amount: 1000,
  date: day("2026-03-02"),
  type: "rent",
  status: "paid",
  lifecycle: "emitted",
  referenceMonth: "2026-03",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireOwnerAccessMock.mockResolvedValue({ userId: "user-1", scopeUserId: "user-1" });
  prismaMock.propertyOwner.findMany.mockResolvedValue([
    {
      propertyId: "p1",
      ownerId: "ana",
      ownershipPercentage: 50,
      validFrom: null,
      validTo: null,
      owner: { name: "Ana" },
      property: { name: "T2" },
    },
    {
      propertyId: "p1",
      ownerId: "rui",
      ownershipPercentage: 50,
      validFrom: null,
      validTo: null,
      owner: { name: "Rui" },
      property: { name: "T2" },
    },
  ]);
  prismaMock.receipt.findMany.mockResolvedValue([]);
  prismaMock.expense.findMany.mockResolvedValue([]);
  prismaMock.ownerPayout.findMany.mockResolvedValue([]);
});

describe("GET /api/owner-payouts", () => {
  it("reads only the caller's shares, receipts, expenses and payouts for the year", async () => {
    await GET(new NextRequest(`${url}?year=2026`));

    const range = { gte: day("2026-01-01"), lt: day("2027-01-01") };
    expect(prismaMock.propertyOwner.findMany.mock.calls[0][0].where).toEqual({
      property: { userId: "user-1" },
      owner: { userId: "user-1" },
    });
    expect(prismaMock.receipt.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      date: range,
      status: "paid",
    });
    expect(prismaMock.expense.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      date: range,
    });
    expect(prismaMock.ownerPayout.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      year: 2026,
      owner: { userId: "user-1" },
    });
  });

  it("counts rent received, but no deposit and nothing voided", async () => {
    prismaMock.receipt.findMany.mockResolvedValue([
      receipt(),
      receipt({ type: "deposit", amount: 2000 }),
      receipt({ lifecycle: "voided", amount: 500 }),
    ]);
    prismaMock.expense.findMany.mockResolvedValue([
      { propertyId: "p1", amount: 100, date: day("2026-04-01") },
    ]);
    prismaMock.ownerPayout.findMany.mockResolvedValue([
      { id: "x1", ownerId: "rui", amount: 200, paidAt: day("2026-06-01"), note: null },
    ]);

    const res = await GET(new NextRequest(`${url}?year=2026`));
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ income: 1000, expenses: 100, net: 900, paid: 200 });
    const balances = Object.fromEntries(
      data.owners.map((o: { ownerId: string; balance: number }) => [o.ownerId, o.balance]),
    );
    expect(balances).toEqual({ ana: 450, rui: 250 });
  });
});

describe("POST /api/owner-payouts", () => {
  it("records a payout to the caller's owner and audits it", async () => {
    prismaMock.owner.findFirst.mockResolvedValue({ id: "rui", name: "Rui" });
    prismaMock.ownerPayout.create.mockResolvedValue({
      id: "x1",
      ownerId: "rui",
      year: 2026,
      amount: 450,
    });

    const res = await POST(
      post({ ownerId: "rui", year: 2026, amount: 450, paidAt: "2026-12-30", note: " IBAN " }),
    );

    expect(res.status).toBe(201);
    expect(prismaMock.owner.findFirst).toHaveBeenCalledWith({
      where: { id: "rui", userId: "user-1" },
      select: { id: true, name: true },
    });
    expect(prismaMock.ownerPayout.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        ownerId: "rui",
        year: 2026,
        amount: 450,
        paidAt: day("2026-12-30"),
        note: "IBAN",
      },
    });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RECORD_OWNER_PAYOUT", resourceId: "x1" }),
    );
  });

  it("answers another account's owner as a 404 and writes nothing", async () => {
    prismaMock.owner.findFirst.mockResolvedValue(null);

    const res = await POST(
      post({ ownerId: "other", year: 2026, amount: 10, paidAt: "2026-12-30" }),
    );

    expect(res.status).toBe(404);
    expect(prismaMock.ownerPayout.create).not.toHaveBeenCalled();
  });

  it("refuses an amount of zero as a 400", async () => {
    const res = await POST(post({ ownerId: "rui", year: 2026, amount: 0, paidAt: "2026-12-30" }));

    expect(res.status).toBe(400);
    expect(prismaMock.ownerPayout.create).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/owner-payouts/[id]", () => {
  it("removes only the caller's payout", async () => {
    prismaMock.ownerPayout.findFirst.mockResolvedValue(null);

    const res = await DELETE(new NextRequest(`${url}/x9`, { method: "DELETE" }), {
      params: Promise.resolve({ id: "x9" }),
    });

    expect(res.status).toBe(404);
    expect(prismaMock.ownerPayout.findFirst).toHaveBeenCalledWith({
      where: { id: "x9", userId: "user-1" },
    });
    expect(prismaMock.ownerPayout.delete).not.toHaveBeenCalled();
  });
});
