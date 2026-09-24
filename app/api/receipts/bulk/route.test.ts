import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Bulk receipt generation writes one rent receipt per active lease per month. The guard that
 * matters is idempotency: it looks for an existing rent receipt in the month window and skips
 * rather than writing a second one. Losing that means double-billing a whole portfolio on a
 * re-run, so it is pinned here along with the month window it searches.
 */

const { requireOwnerAccessMock, allocateReceiptMock, prismaMock } = vi.hoisted(() => ({
  requireOwnerAccessMock: vi.fn(),
  allocateReceiptMock: vi.fn(),
  prismaMock: {
    lease: { findMany: vi.fn() },
    receipt: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: requireOwnerAccessMock,
  handleOptions: vi.fn(),
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/allocation/service", () => ({ allocateReceipt: allocateReceiptMock }));

import { POST } from "./route";

const bulkRequest = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/receipts/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const lease = {
  id: "lease-1",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  monthlyRent: 950,
  tenant: { name: "Ana Costa" },
  property: { name: "Rua Augusta 12" },
};

const createdReceipt = {
  id: "rec-1",
  userId: "user-123",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  amount: 950,
  date: new Date("2026-03-01"),
  type: "rent",
  status: "paid",
  description: "Monthly rent — 2026-03",
  createdAt: new Date("2026-03-01"),
  updatedAt: new Date("2026-03-01"),
  tenant: { name: "Ana Costa" },
  property: { name: "Rua Augusta 12" },
};

describe("POST /api/receipts/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOwnerAccessMock.mockResolvedValue({ scopeUserId: "user-123" });
    prismaMock.lease.findMany.mockResolvedValue([lease]);
    prismaMock.receipt.findFirst.mockResolvedValue(null);
    prismaMock.receipt.create.mockResolvedValue(createdReceipt);
    allocateReceiptMock.mockResolvedValue(null);
  });

  it("generates a receipt for an active lease with none yet that month", async () => {
    const res = await POST(bulkRequest({ month: "2026-03" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ skipped: 0, errors: [] }),
      }),
    );
    expect(prismaMock.receipt.create).toHaveBeenCalledTimes(1);
  });

  it("skips a lease that already has a rent receipt that month instead of billing twice", async () => {
    prismaMock.receipt.findFirst.mockResolvedValue({ id: "existing-rec" });

    const res = await POST(bulkRequest({ month: "2026-03" }));

    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ skipped: 1, generated: [] }) }),
    );
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
  });

  it("searches the correct month window, half-open at the next month", async () => {
    await POST(bulkRequest({ month: "2026-03" }));

    expect(prismaMock.receipt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "rent",
          date: { gte: new Date(2026, 2, 1), lt: new Date(2026, 3, 1) },
        }),
      }),
    );
  });

  it("only considers active leases belonging to the caller", async () => {
    await POST(bulkRequest({ month: "2026-03" }));

    expect(prismaMock.lease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-123", status: "active" }),
      }),
    );
  });

  it("narrows to the supplied leaseIds when given", async () => {
    await POST(bulkRequest({ month: "2026-03", leaseIds: ["lease-1", "lease-2"] }));

    expect(prismaMock.lease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["lease-1", "lease-2"] } }),
      }),
    );
  });

  // The Finance screen used to POST every generated receipt back to /api/receipts, which wrote each
  // one a second time — and only that copy went through the waterfall, because this route never
  // allocated. A generated receipt now arrives linked and allocated, so there is nothing to resend.
  it("links each receipt to its lease and allocates it, as a single receipt is", async () => {
    await POST(bulkRequest({ month: "2026-03" }));

    expect(prismaMock.receipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leaseId: "lease-1" }) }),
    );
    expect(allocateReceiptMock).toHaveBeenCalledWith("rec-1");
  });

  it("keeps a receipt whose allocation failed, as a single receipt does", async () => {
    allocateReceiptMock.mockRejectedValueOnce(new Error("ledger busy"));

    const res = await POST(bulkRequest({ month: "2026-03" }));
    const payload = (await res.json()) as { data: { generated: unknown[]; errors: string[] } };

    expect(allocateReceiptMock).toHaveBeenCalledTimes(1);
    expect(payload.data.generated).toHaveLength(1);
    expect(payload.data.errors).toEqual([]);
  });

  it("returns 400 for a month that is not YYYY-MM", async () => {
    const res = await POST(bulkRequest({ month: "March 2026" }));

    expect(res.status).toBe(400);
    expect(prismaMock.lease.findMany).not.toHaveBeenCalled();
  });

  it("isolates a per-lease failure so the rest of the batch still runs", async () => {
    prismaMock.lease.findMany.mockResolvedValue([lease, { ...lease, id: "lease-2" }]);
    prismaMock.receipt.create
      .mockRejectedValueOnce(new Error("db write failed"))
      .mockResolvedValueOnce(createdReceipt);

    const res = await POST(bulkRequest({ month: "2026-03" }));
    const payload = (await res.json()) as { data: { generated: unknown[]; errors: string[] } };

    expect(payload.data.generated).toHaveLength(1);
    expect(payload.data.errors).toHaveLength(1);
    expect(payload.data.errors[0]).toContain("db write failed");
  });
});
