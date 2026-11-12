import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A property can be filed under a building. `buildingId` came from the request and was written
 * unchecked, so a property could be hung on another landlord's building, where it counted in
 * their building's property total.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    // Read by derived-state: no lease and no rent month, so the stored values stand.
    lease: { findMany: vi.fn(async () => []) },
    rentPeriod: { findMany: vi.fn(async () => []) },
    property: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(async () => null) },
    building: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { coordinatesAfterEdit, propertyService } from "./service";

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
  // Finanças does not say how many rooms a property has. Unknown is NULL; 0 is a studio, and a
  // property that is one has to keep saying so.
  it("files unknown rooms as NULL, and a studio's none as 0", async () => {
    await propertyService.create("user-1", {
      ...property,
      bedrooms: undefined,
      bathrooms: null,
    } as unknown as Parameters<typeof propertyService.create>[1]);
    await propertyService.create("user-1", { ...property, bedrooms: 0, bathrooms: 1 });

    const [unknown, studio] = prismaMock.property.create.mock.calls.map(([call]) => call.data);
    expect(unknown.bedrooms).toBeNull();
    expect(unknown.bathrooms).toBeNull();
    expect(studio.bedrooms).toBe(0);
    expect(studio.bathrooms).toBe(1);
  });

  // The service writes an explicit field list, so a field the schema accepts but the list leaves
  // out is dropped without a word. That is how the property form lost fields until #399.
  it("writes the matriz article and the fraction, on create and on update", async () => {
    await propertyService.create("user-1", {
      ...property,
      cadasterReference: "2321",
      fraction: "C",
    });
    await propertyService.update("user-1", "prop-1", { cadasterReference: "2321-A", fraction: "" });

    expect(prismaMock.property.create.mock.calls[0][0].data).toMatchObject({
      cadasterReference: "2321",
      fraction: "C",
    });
    expect(prismaMock.property.update.mock.calls[0][0].data).toMatchObject({
      cadasterReference: "2321-A",
      fraction: "",
    });
  });
});

// The Portfolio map places a property from its coordinates. An edit that changed the address and
// sent back the old coordinates left the pin at the old address for good.
describe("coordinatesAfterEdit", () => {
  const stored = {
    address: "Rua de Angola 25, 2º ESQ, 1170-020 Lisboa",
    streetAddress: "Rua de Angola 25",
    city: "Lisboa",
    zipCode: "1170-020",
    latitude: 38.72,
    longitude: -9.13,
  };

  it("clears the coordinates when the address changes and the place does not", () => {
    expect(
      coordinatesAfterEdit(stored, {
        address: "Rua Augusta 12, Lisboa",
        streetAddress: "Rua Augusta 12",
        latitude: 38.72,
        longitude: -9.13,
      }),
    ).toEqual({ latitude: null, longitude: null });
  });

  it("writes a new place picked with the new address", () => {
    expect(
      coordinatesAfterEdit(stored, {
        address: "Rua Augusta 12, Lisboa",
        latitude: 38.71,
        longitude: -9.137,
      }),
    ).toEqual({ latitude: 38.71, longitude: -9.137 });
  });

  it("leaves the coordinates alone when the address is unchanged", () => {
    expect(
      coordinatesAfterEdit(stored, {
        address: ` ${stored.address} `,
        latitude: 38.72,
        longitude: -9.13,
      }),
    ).toEqual({ latitude: 38.72, longitude: -9.13 });
    expect(coordinatesAfterEdit(stored, { name: "x" } as never)).toEqual({
      latitude: undefined,
      longitude: undefined,
    });
  });
});
