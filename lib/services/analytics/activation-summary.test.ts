import { describe, it, expect, vi } from "vitest";
import { getActivationSummary, getComplianceStreak } from "./activation-summary";

type Prisma = Parameters<typeof getActivationSummary>[0];

function makePrisma(overrides: Record<string, unknown>): Prisma {
  return overrides as unknown as Prisma;
}

describe("getActivationSummary", () => {
  it("reports not activated when a step is missing", async () => {
    const prisma = makePrisma({
      property: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-01-01") }) },
      tenant: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-01-02") }) },
      lease: { findFirst: vi.fn().mockResolvedValue(null) },
      receipt: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    const summary = await getActivationSummary(prisma, "user-1");

    expect(summary.isActivated).toBe(false);
    expect(summary.activatedAt).toBeNull();
    expect(summary.firstLeaseAt).toBeNull();
    expect(summary.firstPaidReceiptAt).toBeNull();
  });

  it("reports activated with activatedAt as the latest of the four steps", async () => {
    const prisma = makePrisma({
      property: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-01-01") }) },
      tenant: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-01-03") }) },
      lease: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-01-02") }) },
      receipt: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-01-10") }) },
    });

    const summary = await getActivationSummary(prisma, "user-1");

    expect(summary.isActivated).toBe(true);
    expect(summary.activatedAt).toEqual(new Date("2026-01-10"));
  });

  it("queries the receipt step scoped to paid status only", async () => {
    const receiptFindFirst = vi.fn().mockResolvedValue(null);
    const prisma = makePrisma({
      property: { findFirst: vi.fn().mockResolvedValue(null) },
      tenant: { findFirst: vi.fn().mockResolvedValue(null) },
      lease: { findFirst: vi.fn().mockResolvedValue(null) },
      receipt: { findFirst: receiptFindFirst },
    });

    await getActivationSummary(prisma, "user-1");

    expect(receiptFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", status: "paid" } }),
    );
  });
});

describe("getComplianceStreak", () => {
  const referenceDate = new Date("2026-04-15T00:00:00.000Z");

  it("reports no history when the user has no leases", async () => {
    const receiptFindMany = vi.fn();
    const prisma = makePrisma({
      lease: { findMany: vi.fn().mockResolvedValue([]) },
      receipt: { findMany: receiptFindMany },
    });

    const streak = await getComplianceStreak(prisma, "user-1", referenceDate);

    expect(streak).toEqual({ streakMonths: 0, hasHistory: false });
    expect(receiptFindMany).not.toHaveBeenCalled();
  });

  it("counts consecutive clean months back to the start of the lease", async () => {
    const prisma = makePrisma({
      lease: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "lease-1",
            startDate: new Date("2026-01-01"),
            endDate: new Date("2026-12-31"),
          },
        ]),
      },
      receipt: {
        findMany: vi.fn().mockResolvedValue([
          { leaseId: "lease-1", date: new Date("2026-01-10") },
          { leaseId: "lease-1", date: new Date("2026-02-10") },
          { leaseId: "lease-1", date: new Date("2026-03-10") },
        ]),
      },
    });

    const streak = await getComplianceStreak(prisma, "user-1", referenceDate);

    expect(streak).toEqual({ streakMonths: 3, hasHistory: true });
  });

  it("stops the streak at the most recent month missing a paid rent receipt", async () => {
    const prisma = makePrisma({
      lease: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "lease-1",
            startDate: new Date("2026-01-01"),
            endDate: new Date("2026-12-31"),
          },
        ]),
      },
      receipt: {
        findMany: vi.fn().mockResolvedValue([
          // February is missing — only March is paid.
          { leaseId: "lease-1", date: new Date("2026-03-05") },
        ]),
      },
    });

    const streak = await getComplianceStreak(prisma, "user-1", referenceDate);

    expect(streak).toEqual({ streakMonths: 1, hasHistory: true });
  });
});
