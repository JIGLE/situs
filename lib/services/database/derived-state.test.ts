import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    lease: { findMany: vi.fn() },
    rentPeriod: { findMany: vi.fn() },
    property: { count: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import {
  countOccupied,
  currentLeaseOf,
  derivePropertyStatuses,
  deriveTenants,
  paymentStatusAt,
  propertyStatusAt,
  type LeaseFacts,
} from "./derived-state";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function lease(over: Partial<LeaseFacts> = {}): LeaseFacts {
  return {
    id: "lease-1",
    tenantId: "t-1",
    propertyId: "p-1",
    status: "active",
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: new Date("2026-12-31T00:00:00.000Z"),
    monthlyRent: 750,
    ...over,
  };
}

function month(over: { due: string; allocated?: number; paidAt?: string | null; status?: string }) {
  return {
    tenantId: "t-1",
    status: over.status ?? "upcoming",
    dueDate: new Date(over.due),
    dueAmount: 750,
    allocatedAmount: over.allocated ?? 0,
    paidAt: over.paidAt ? new Date(over.paidAt) : null,
  };
}

describe("currentLeaseOf", () => {
  it("takes the active lease that started last, over an older or an ended one", () => {
    const leases = [
      lease({ id: "old", status: "terminated", startDate: new Date("2025-01-01") }),
      lease({ id: "renewal", startDate: new Date("2026-06-01") }),
      lease({ id: "first", startDate: new Date("2026-01-01") }),
    ];
    expect(currentLeaseOf(leases)?.id).toBe("renewal");
  });

  it("falls back to a lease being set up, then to the latest lease of any status", () => {
    expect(
      currentLeaseOf([
        lease({ id: "ended", status: "expired" }),
        lease({ id: "draft", status: "draft", startDate: new Date("2025-06-01") }),
      ])?.id,
    ).toBe("draft");
    expect(
      currentLeaseOf([
        lease({ id: "older", status: "expired", startDate: new Date("2024-01-01") }),
        lease({ id: "newer", status: "terminated", startDate: new Date("2025-01-01") }),
      ])?.id,
    ).toBe("newer");
    expect(currentLeaseOf([])).toBeUndefined();
  });
});

describe("paymentStatusAt", () => {
  it("reads a month nobody paid as overdue once its due date has passed, whatever it stored", () => {
    // Stored "upcoming" because nothing was ever allocated: the stored status is not a clock.
    expect(paymentStatusAt([month({ due: "2026-08-01T00:00:00.000Z" })], NOW)).toBe("overdue");
  });

  it("is paid when every month due is paid, and pending while one is due but not late", () => {
    expect(
      paymentStatusAt(
        [
          month({
            due: "2026-08-01T00:00:00.000Z",
            allocated: 750,
            paidAt: "2026-08-01T00:00:00.000Z",
          }),
        ],
        NOW,
      ),
    ).toBe("paid");
    expect(paymentStatusAt([month({ due: "2026-08-15T00:00:00.000Z" })], NOW)).toBe("pending");
  });

  it("does not chase a waived month, and says nothing without months", () => {
    expect(
      paymentStatusAt([month({ due: "2026-07-01T00:00:00.000Z", status: "waived" })], NOW),
    ).toBe("paid");
    expect(paymentStatusAt([], NOW)).toBeNull();
  });
});

describe("propertyStatusAt", () => {
  it("is occupied while an active lease has started, and vacant otherwise", () => {
    expect(propertyStatusAt("vacant", [lease()], NOW)).toBe("occupied");
    expect(propertyStatusAt("occupied", [], NOW)).toBe("vacant");
    expect(propertyStatusAt("occupied", [lease({ status: "terminated" })], NOW)).toBe("vacant");
    expect(
      propertyStatusAt("vacant", [lease({ startDate: new Date("2026-09-01T00:00:00.000Z") })], NOW),
    ).toBe("vacant");
  });

  it("keeps the owner's maintenance flag, which no lease speaks to", () => {
    expect(propertyStatusAt("maintenance", [lease()], NOW)).toBe("maintenance");
  });
});

describe("the reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives each tenant its current lease's terms and the ledger's status, scoped to the owner", async () => {
    prismaMock.lease.findMany.mockResolvedValue([
      { ...lease({ monthlyRent: 820 }), property: { name: "Rua Augusta 12" } },
    ]);
    prismaMock.rentPeriod.findMany.mockResolvedValue([month({ due: "2026-08-01T00:00:00.000Z" })]);

    const derived = await deriveTenants("user-1", ["t-1", "t-2"], NOW);

    expect(derived.get("t-1")).toMatchObject({
      propertyId: "p-1",
      propertyName: "Rua Augusta 12",
      rent: 820,
      paymentStatus: "overdue",
    });
    // No lease: the tenant keeps what is stored.
    expect(derived.has("t-2")).toBe(false);
    expect(prismaMock.lease.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      tenantId: { in: ["t-1", "t-2"] },
    });
    expect(prismaMock.rentPeriod.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      tenantId: { in: ["t-1", "t-2"] },
    });
  });

  it("reads each property's occupancy from its active leases", async () => {
    prismaMock.lease.findMany.mockResolvedValue([lease({ propertyId: "p-1" })]);

    const statuses = await derivePropertyStatuses(
      "user-1",
      [
        { id: "p-1", status: "vacant" },
        { id: "p-2", status: "occupied" },
        { id: "p-3", status: "maintenance" },
      ],
      NOW,
    );

    expect(Object.fromEntries(statuses)).toEqual({
      "p-1": "occupied",
      "p-2": "vacant",
      "p-3": "maintenance",
    });
  });

  it("counts occupied properties by the same rule", async () => {
    prismaMock.property.count.mockResolvedValue(3);

    expect(await countOccupied("user-1", NOW)).toBe(3);
    expect(prismaMock.property.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: { not: "maintenance" },
        leases: { some: { status: "active", startDate: { lte: NOW } } },
      },
    });
  });

  it("asks nothing for an empty list", async () => {
    expect((await deriveTenants("user-1", [], NOW)).size).toBe(0);
    expect((await derivePropertyStatuses("user-1", [], NOW)).size).toBe(0);
    expect(prismaMock.lease.findMany).not.toHaveBeenCalled();
  });
});
