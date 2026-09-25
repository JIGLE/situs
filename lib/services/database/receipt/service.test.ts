import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A receipt keeps the lease it was recorded against. The create used to drop `leaseId`, so
 * allocation had to guess the lease from the tenant, and gave up on a tenant with two active
 * leases: the payment reached no month at all. The lease must be the caller's, and the tenant's
 * lease on that property, or the payment would settle another contract's months.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tenant: { findFirst: vi.fn() },
    property: { findFirst: vi.fn() },
    lease: { findFirst: vi.fn() },
    receipt: { create: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/allocation/service", () => ({ reverseAllocationsForReceipt: vi.fn() }));

import { receiptService } from "./service";
import { ResourceNotFoundError, ValidationError } from "@/lib/utils/error-handling";

const payment = {
  tenantId: "tenant-1",
  propertyId: "property-1",
  leaseId: "lease-1",
  amount: 800,
  date: "2026-08-03",
  type: "rent" as const,
  status: "paid" as const,
};

describe("receiptService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" });
    prismaMock.property.findFirst.mockResolvedValue({ id: "property-1" });
    prismaMock.lease.findFirst.mockResolvedValue({
      tenantId: "tenant-1",
      propertyId: "property-1",
    });
    prismaMock.receipt.create.mockImplementation(async ({ data }) => ({
      id: "receipt-1",
      ...data,
      description: null,
      createdAt: new Date("2026-08-03T10:00:00.000Z"),
      updatedAt: new Date("2026-08-03T10:00:00.000Z"),
      tenant: { name: "Zé Pereira" },
      property: { name: "Rua do Ouro 3" },
    }));
  });

  it("saves the lease the payment was recorded against", async () => {
    const receipt = await receiptService.create("user-1", payment);

    expect(prismaMock.lease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lease-1", userId: "user-1" } }),
    );
    expect(prismaMock.receipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leaseId: "lease-1" }) }),
    );
    expect(receipt.leaseId).toBe("lease-1");
  });

  it.each([
    ["another tenant's", { tenantId: "tenant-2", propertyId: "property-1" }],
    ["on another property", { tenantId: "tenant-1", propertyId: "property-2" }],
  ])("refuses a lease that is %s, and saves nothing", async (_, lease) => {
    prismaMock.lease.findFirst.mockResolvedValue(lease);

    const error = await receiptService.create("user-1", payment).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe("leaseId");
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
  });

  it("refuses another owner's lease as one that does not exist", async () => {
    prismaMock.lease.findFirst.mockResolvedValue(null);

    await expect(receiptService.create("user-1", payment)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(prismaMock.receipt.create).not.toHaveBeenCalled();
  });

  it("records a payment without a lease as before, looking none up", async () => {
    const { leaseId: _leaseId, ...withoutLease } = payment;

    const receipt = await receiptService.create("user-1", withoutLease);

    expect(prismaMock.lease.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.receipt.create.mock.calls[0][0].data.leaseId).toBeUndefined();
    expect(receipt.leaseId).toBeUndefined();
  });
});
