import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tenantService.create` checks the property a tenant is filed under; `update` wrote a new
 * `propertyId` unchecked. The update `include`s the property, so re-pointing a tenant at someone
 * else's property echoed that property's full record back.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tenant: { update: vi.fn() },
    property: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { tenantService } from "./service";

describe("tenantService.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A stored row, as the service maps it: dates are Dates, as Prisma returns them.
    prismaMock.tenant.update.mockImplementation(async ({ data }) => ({
      id: "tenant-1",
      userId: "user-1",
      name: "Ana Costa",
      propertyId: data.propertyId,
      leaseStart: new Date("2026-01-01T00:00:00.000Z"),
      leaseEnd: new Date("2026-12-31T00:00:00.000Z"),
      lastPayment: null,
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      property: { name: "Rua Augusta 12" },
    }));
  });

  it("refuses a property the caller does not own", async () => {
    prismaMock.property.findFirst.mockResolvedValue(null);

    await expect(
      tenantService.update("user-1", "tenant-1", { propertyId: "someone-elses-property" }),
    ).rejects.toThrow("Property not found");
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  it("checks the property against the caller", async () => {
    prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });

    await tenantService.update("user-1", "tenant-1", { propertyId: "prop-1" });

    expect(prismaMock.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "prop-1", userId: "user-1" } }),
    );
    expect(prismaMock.tenant.update).toHaveBeenCalledTimes(1);
  });
});
