import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A property can be filed under a building. `buildingId` came from the request and was written
 * unchecked, so a property could be hung on another landlord's building, where it counted in
 * their building's property total.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    property: { create: vi.fn(), update: vi.fn() },
    building: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { propertyService } from "./service";

const property = {
  name: "Rua Augusta 12",
  address: "Rua Augusta 12, Lisboa",
  type: "apartment",
  bedrooms: 2,
  bathrooms: 1,
  rent: 950,
  status: "vacant",
} as unknown as Parameters<typeof propertyService.create>[1];

describe("propertyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.building.findFirst.mockResolvedValue(null);
    // A stored row, as the service maps it: dates are Dates, as Prisma returns them.
    const row = async ({ data }: { data: Record<string, unknown> }) => ({
      id: "prop-1",
      userId: "user-1",
      ...data,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    prismaMock.property.create.mockImplementation(row);
    prismaMock.property.update.mockImplementation(row);
  });

  it("refuses to create a property under a building the caller does not own", async () => {
    await expect(
      propertyService.create("user-1", { ...property, buildingId: "someone-elses-building" }),
    ).rejects.toThrow("Building not found");
    expect(prismaMock.property.create).not.toHaveBeenCalled();
  });

  it("refuses to move a property under a building the caller does not own", async () => {
    await expect(
      propertyService.update("user-1", "prop-1", { buildingId: "someone-elses-building" }),
    ).rejects.toThrow("Building not found");
    expect(prismaMock.property.update).not.toHaveBeenCalled();
  });
});
