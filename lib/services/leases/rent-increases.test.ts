import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rent increase is decided ahead of the month it starts. It used to be a new number written onto
 * the lease at once, so the higher rent was owed before the tenant could have been told.
 */

const { db, sync } = vi.hoisted(() => {
  const db = {
    lease: { findFirst: vi.fn(), update: vi.fn() },
    rentIncrease: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { db, sync: vi.fn(async () => ({ created: 0, removed: 0, waived: 0, repriced: 3 })) };
});

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => db }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/services/allocation/service", () => ({
  syncLeasePeriods: sync,
  auditLeasePeriodSync: vi.fn(),
}));

import { applyDueRentIncreases, cancelRentIncrease, scheduleRentIncrease } from "./rent-increases";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const MARCH = new Date("2027-03-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof db) => unknown)(db) : arg,
  );
  db.lease.findFirst.mockResolvedValue({ id: "lease-1", status: "active", monthlyRent: 735 });
  db.rentIncrease.count.mockResolvedValue(0);
  db.rentIncrease.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: "inc-1",
    ...data,
  }));
});

describe("scheduleRentIncrease", () => {
  it("records the new rent from the start month and reprices the months in the same transaction", async () => {
    await scheduleRentIncrease("user-1", "lease-1", { effectiveFrom: MARCH, percent: 2.24 }, NOW);

    expect(db.rentIncrease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        leaseId: "lease-1",
        effectiveFrom: MARCH,
        previousRent: 735,
        newRent: 751.46,
        percent: 2.24,
      }),
    });
    expect(sync).toHaveBeenCalledWith("lease-1", db, NOW);
    // The lease keeps its rent until March arrives.
    expect(db.lease.update).not.toHaveBeenCalled();
  });

  it("refuses a month that has already begun", async () => {
    await expect(
      scheduleRentIncrease(
        "user-1",
        "lease-1",
        { effectiveFrom: new Date("2026-11-01T00:00:00.000Z"), percent: 2 },
        NOW,
      ),
    ).rejects.toMatchObject({ reason: "rent_increase_not_ahead" });
    expect(db.rentIncrease.create).not.toHaveBeenCalled();
  });

  it("refuses a second increase while one is waiting", async () => {
    db.rentIncrease.count.mockResolvedValue(1);
    await expect(
      scheduleRentIncrease("user-1", "lease-1", { effectiveFrom: MARCH, percent: 2 }, NOW),
    ).rejects.toMatchObject({ reason: "rent_increase_pending" });
  });

  it("refuses a lease that is not active, and one the caller does not own", async () => {
    db.lease.findFirst.mockResolvedValueOnce({ id: "lease-1", status: "draft", monthlyRent: 700 });
    await expect(
      scheduleRentIncrease("user-1", "lease-1", { effectiveFrom: MARCH, percent: 2 }, NOW),
    ).rejects.toMatchObject({ reason: "lease_not_active" });

    db.lease.findFirst.mockResolvedValueOnce(null);
    await expect(
      scheduleRentIncrease("user-2", "lease-1", { effectiveFrom: MARCH, percent: 2 }, NOW),
    ).rejects.toThrow(/not found/);
  });
});

describe("cancelRentIncrease", () => {
  it("removes a pending increase and puts the months back", async () => {
    db.rentIncrease.findFirst.mockResolvedValue({ appliedAt: null });
    await cancelRentIncrease("user-1", "lease-1", "inc-1", NOW);
    expect(db.rentIncrease.delete).toHaveBeenCalledWith({ where: { id: "inc-1" } });
    expect(sync).toHaveBeenCalledWith("lease-1", db, NOW);
  });

  it("keeps one that has taken effect, as the rent's history", async () => {
    db.rentIncrease.findFirst.mockResolvedValue({ appliedAt: new Date() });
    await expect(cancelRentIncrease("user-1", "lease-1", "inc-1", NOW)).rejects.toMatchObject({
      reason: "rent_increase_applied",
    });
    expect(db.rentIncrease.delete).not.toHaveBeenCalled();
  });
});

describe("applyDueRentIncreases", () => {
  it("writes the rent of each increase whose month has come onto its lease", async () => {
    db.rentIncrease.findMany.mockResolvedValue([
      { id: "inc-1", leaseId: "lease-1", newRent: 751.46 },
    ]);

    expect(await applyDueRentIncreases("user-1", MARCH)).toBe(1);

    expect(db.rentIncrease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { appliedAt: null, effectiveFrom: { lte: MARCH }, userId: "user-1" },
      }),
    );
    expect(db.lease.update).toHaveBeenCalledWith({
      where: { id: "lease-1" },
      data: { monthlyRent: 751.46 },
    });
    expect(db.rentIncrease.update).toHaveBeenCalledWith({
      where: { id: "inc-1", appliedAt: null },
      data: { appliedAt: MARCH },
    });
  });
});
