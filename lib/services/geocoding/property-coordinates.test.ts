import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    property: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import { GEOCODE_BATCH, placeMissingProperties } from "./property-coordinates";
import { resetGeocoderForTests } from "./nominatim";

const row = (id: string, street: string) => ({
  id,
  address: `${street}, Lisboa`,
  streetAddress: street,
  city: "Lisboa",
  zipCode: null,
});

describe("placeMissingProperties", () => {
  const wait = async () => undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    resetGeocoderForTests();
    prismaMock.property.updateMany.mockResolvedValue({ count: 1 });
  });

  it("reads only the caller's unplaced properties and writes only their coordinates", async () => {
    prismaMock.property.findMany.mockResolvedValue([row("p1", "Rua Augusta 12")]);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ lat: "38.71", lon: "-9.137" }],
    } as Response);

    const result = await placeMissingProperties("user-1", { fetch, wait });

    expect(prismaMock.property.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      OR: [{ latitude: null }, { longitude: null }],
    });
    expect(prismaMock.property.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", userId: "user-1", latitude: null },
      data: { latitude: 38.71, longitude: -9.137, locationPrecision: "area" },
    });
    expect(result).toEqual({
      placed: [{ id: "p1", latitude: 38.71, longitude: -9.137, precision: "area" }],
      remaining: 0,
    });
  });

  it("places a batch at a time and says how many are left", async () => {
    const rows = Array.from({ length: GEOCODE_BATCH + 2 }, (_, i) => row(`p${i}`, `Rua ${i}`));
    prismaMock.property.findMany.mockResolvedValue(rows);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ lat: "38.7", lon: "-9.1" }],
    } as Response);

    const result = await placeMissingProperties("user-1", { fetch, wait });
    expect(result.placed).toHaveLength(GEOCODE_BATCH);
    expect(result.remaining).toBe(2);
  });

  it("skips an address that already found nothing", async () => {
    prismaMock.property.findMany.mockResolvedValue([row("p1", "Rua Inexistente 1")]);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);

    await placeMissingProperties("user-1", { fetch, wait });
    const calls = fetch.mock.calls.length;
    const again = await placeMissingProperties("user-1", { fetch, wait });
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(again).toEqual({ placed: [], remaining: 0 });
  });
});
