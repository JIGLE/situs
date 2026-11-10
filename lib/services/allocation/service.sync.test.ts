import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which months a lease owes, after the lease changes.
 *
 * Rent months used to be generated for every new lease, draft included, and nothing took them
 * away again: a draft that never started, or a lease terminated early, kept months that the
 * dashboard counted as owed and the overdue reminders chased. A rent update never reached the
 * year of months already generated ahead. `syncLeasePeriods` brings the ledger back in step, on the
 * client it is given, so the lease write and the months land together.
 */

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => ({}) }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));

import { syncLeasePeriods } from "./service";

const NOW = new Date("2026-06-15T00:00:00.000Z");

interface Row {
  id: string;
  dueDate: Date;
  dueAmount: number;
  status: string;
  allocations: { reversedAt: Date | null }[];
}

const month = (id: string, iso: string, allocations: Row["allocations"] = [], dueAmount = 900) => ({
  id,
  dueDate: new Date(`${iso}T00:00:00.000Z`),
  dueAmount,
  status: "upcoming",
  allocations,
});

function fakeClient(lease: Record<string, unknown>, rows: Row[]) {
  return {
    lease: { findUnique: vi.fn(async () => lease) },
    rentPeriod: {
      findMany: vi.fn(async (args: { select: Record<string, unknown> }) =>
        // The months that exist, as `generateRentPeriods` asks for them, or the full rows.
        "allocations" in args.select
          ? rows
          : rows.map((r) => ({
              year: r.dueDate.getUTCFullYear(),
              month: r.dueDate.getUTCMonth() + 1,
            })),
      ),
      delete: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
    },
  };
}

const lease = (overrides: Record<string, unknown> = {}) => ({
  id: "lease-1",
  userId: "user-1",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  status: "active",
  monthlyRent: 900,
  startDate: new Date("2026-05-01T00:00:00.000Z"),
  endDate: new Date("2026-08-31T00:00:00.000Z"),
  ...overrides,
});

const deletedIds = (client: ReturnType<typeof fakeClient>) =>
  client.rentPeriod.delete.mock.calls.map(([args]) => (args as { where: { id: string } }).where.id);

describe("syncLeasePeriods", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes every unpaid month of a draft lease and generates none", async () => {
    const client = fakeClient(lease({ status: "draft" }), [
      month("m5", "2026-05-01"),
      month("m6", "2026-06-01"),
    ]);

    const sync = await syncLeasePeriods("lease-1", client as never, NOW);

    expect(deletedIds(client)).toEqual(["m5", "m6"]);
    expect(client.rentPeriod.createMany).not.toHaveBeenCalled();
    expect(sync).toMatchObject({ removed: 2, created: 0 });
  });

  it("stops a terminated lease's months at today, keeping what was owed before", async () => {
    const client = fakeClient(lease({ status: "terminated" }), [
      month("m5", "2026-05-01"),
      month("m6", "2026-06-01"),
      month("m7", "2026-07-01"),
      month("m8", "2026-08-01"),
    ]);

    await syncLeasePeriods("lease-1", client as never, NOW);

    // May and June fell due while the lease ran, paid or not: they stay owed.
    expect(deletedIds(client)).toEqual(["m7", "m8"]);
  });

  it("removes the months past a shortened end date", async () => {
    const client = fakeClient(lease({ endDate: new Date("2026-06-30T00:00:00.000Z") }), [
      month("m6", "2026-06-01"),
      month("m7", "2026-07-01"),
    ]);

    await syncLeasePeriods("lease-1", client as never, NOW);

    expect(deletedIds(client)).toEqual(["m7"]);
  });

  it("never removes a month with live money on it", async () => {
    const client = fakeClient(lease({ status: "terminated" }), [
      month("m7", "2026-07-01", [{ reversedAt: null }]),
    ]);

    const sync = await syncLeasePeriods("lease-1", client as never, NOW);

    // Prepaid rent past the end is for a person to settle (void, refund), not for this to drop.
    expect(client.rentPeriod.delete).not.toHaveBeenCalled();
    expect(client.rentPeriod.update).not.toHaveBeenCalled();
    expect(sync.removed + sync.waived).toBe(0);
  });

  it("waives, rather than deletes, a month whose only allocations were reversed", async () => {
    const client = fakeClient(lease({ status: "terminated" }), [
      month("m7", "2026-07-01", [{ reversedAt: new Date("2026-06-10T00:00:00.000Z") }]),
    ]);

    await syncLeasePeriods("lease-1", client as never, NOW);

    // Deleting it would cascade its allocation history away.
    expect(client.rentPeriod.delete).not.toHaveBeenCalled();
    expect(client.rentPeriod.update).toHaveBeenCalledWith({
      where: { id: "m7" },
      data: { status: "waived" },
    });
  });

  it("gives future unpaid months the new rent and leaves past months at theirs", async () => {
    const client = fakeClient(lease({ monthlyRent: 950 }), [
      month("m5", "2026-05-01"),
      month("m7", "2026-07-01"),
      month("m8", "2026-08-01", [{ reversedAt: new Date("2026-06-01T00:00:00.000Z") }]),
    ]);

    const sync = await syncLeasePeriods("lease-1", client as never, NOW);

    // May was owed at 900 when it fell due; August has payment history, so its figure stands.
    expect(client.rentPeriod.update).toHaveBeenCalledTimes(1);
    expect(client.rentPeriod.update).toHaveBeenCalledWith({
      where: { id: "m7" },
      data: { dueAmount: 950 },
    });
    expect(sync.repriced).toBe(1);
  });

  it("generates the missing months of an active lease", async () => {
    const client = fakeClient(lease(), [month("m5", "2026-05-01")]);

    const sync = await syncLeasePeriods("lease-1", client as never, NOW);

    const created = client.rentPeriod.createMany.mock.calls[0][0] as {
      data: { year: number; month: number }[];
    };
    expect(created.data.map((p) => p.month)).toEqual([6, 7, 8]);
    expect(sync.created).toBe(3);
  });
});
