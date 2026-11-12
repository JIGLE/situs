import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A contract entered after it started owed every month since its start. The owner says from which
 * month Situs tracks it, and which movements already in the bank were its rent.
 */

const { db, candidates, audit } = vi.hoisted(() => ({
  db: {
    lease: { findFirst: vi.fn() },
    bankTransaction: { findMany: vi.fn() },
    rentPeriod: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  candidates: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => db }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: audit }));
vi.mock("@/lib/services/bank/import", () => ({ buildLeaseCandidates: candidates }));

import { rentHistory, settleRentBefore } from "./rent-history";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const real = JSON.stringify({});
const sandbox = JSON.stringify({ isTest: true });

const movement = (id: string, date: string, amount: number, name: string, metadata = real) => ({
  id,
  amount,
  bookingDate: new Date(`${date}T00:00:00.000Z`),
  counterpartyName: name,
  counterpartyIbanHash: null,
  reference: null,
  bankAccount: { connection: { metadata } },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.lease.findFirst.mockResolvedValue({
    id: "lease-1",
    status: "active",
    startDate: new Date("2025-02-01T00:00:00.000Z"),
  });
  candidates.mockResolvedValue([
    { leaseId: "lease-1", tenantName: "Maria da Silva", monthlyRent: 850 },
  ]);
});

describe("rentHistory", () => {
  it("offers the movements of the rent's amount, marking those the payer also points at", async () => {
    db.bankTransaction.findMany.mockResolvedValue([
      movement("t1", "2026-09-01", 850, "MARIA DA SILVA"),
      movement("t2", "2026-10-01", 850, "OUTRA PESSOA"),
      movement("t3", "2026-10-05", 42, "MARIA DA SILVA"),
      movement("t4", "2026-11-01", 850, "MARIA DA SILVA", sandbox),
    ]);
    db.rentPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 10, dueAmount: 850, allocatedAmount: 0 },
      { year: 2026, month: 11, dueAmount: 850, allocatedAmount: 850 },
    ]);

    const history = await rentHistory("user-1", "lease-1", NOW);

    expect(history.startMonth).toBe("2025-02");
    expect(history.suggestions.map((s) => [s.transactionId, s.likely])).toEqual([
      ["t1", true],
      ["t2", false],
    ]);
    expect(history.openMonths).toEqual([{ month: "2026-10", outstanding: 850 }]);
    // Ten days before the first month: a rent paid early still belongs to the tenancy.
    expect(db.bankTransaction.findMany.mock.calls[0][0].where.bookingDate.gte).toEqual(
      new Date("2025-01-22T00:00:00.000Z"),
    );
  });

  it("refuses a lease that owes nothing", async () => {
    db.lease.findFirst.mockResolvedValue({ id: "lease-1", status: "draft", startDate: NOW });
    await expect(rentHistory("user-1", "lease-1", NOW)).rejects.toMatchObject({
      reason: "lease_not_active",
    });
  });
});

describe("settleRentBefore", () => {
  it("marks the months before the chosen one as settled, leaving any with money on them", async () => {
    db.rentPeriod.findMany.mockResolvedValue([
      { id: "p-jan", year: 2026, month: 1, allocations: [] },
      { id: "p-feb", year: 2026, month: 2, allocations: [{ id: "a1" }] },
      { id: "p-mar", year: 2026, month: 3, allocations: [] },
    ]);

    const settled = await settleRentBefore(
      "user-1",
      "lease-1",
      new Date("2026-03-01T00:00:00.000Z"),
    );

    expect(settled).toBe(1);
    expect(db.rentPeriod.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p-jan"] } },
      data: { status: "waived" },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SETTLE_RENT_BEFORE",
        details: { from: "2026-03", months: 1 },
      }),
    );
  });
});
