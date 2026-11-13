import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  alreadyFailed,
  geocode,
  geocodeQueries,
  locate,
  precisionOf,
  resetGeocoderForTests,
  reverseGeocode,
  toReverseAddress,
} from "./nominatim";

/** What an import from a caderneta writes (`lib/services/financas-import/caderneta.ts`). */
const IMPORTED = {
  address: "Rua de Angola 25, 2º ESQ, 1170-020 Lisboa",
  streetAddress: "Rua de Angola 25",
  city: "Lisboa",
  zipCode: "1170-020",
};

const answer = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe("geocodeQueries", () => {
  it("asks for the street without the floor first, then wider", () => {
    expect(geocodeQueries(IMPORTED)).toEqual([
      { street: "Rua de Angola 25", city: "Lisboa", postalcode: "1170-020" },
      { q: "Rua de Angola 25, Lisboa" },
      { postalcode: "1170-020", city: "Lisboa" },
      { city: "Lisboa" },
    ]);
  });

  it("reads the street and postal code off a hand-typed address", () => {
    expect(geocodeQueries({ address: "Rua Augusta 12, 1100-053 Lisboa" })[0]).toEqual({
      street: "Rua Augusta 12",
      postalcode: "1100-053",
    });
  });

  it("falls back to the address as written when nothing is structured", () => {
    expect(geocodeQueries({ address: "Quinta do Lago" })).toEqual([{ q: "Quinta do Lago" }]);
  });
});

describe("geocode", () => {
  const wait = vi.fn(async () => undefined);
  beforeEach(() => {
    resetGeocoderForTests();
    wait.mockClear();
  });

  it("stops at the first query that finds the place", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer([]))
      .mockResolvedValueOnce(answer([{ lat: "38.7262", lon: "-9.1310" }]));
    await expect(geocode(IMPORTED, { fetch, wait })).resolves.toEqual({
      latitude: 38.7262,
      longitude: -9.131,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain("nominatim.openstreetmap.org/search");
    expect(String(url)).toContain("countrycodes=pt");
    expect(init.headers["User-Agent"]).toMatch(/Situs/);
    // The second request waited its turn: Nominatim allows one a second.
    expect(wait).toHaveBeenCalled();
  });

  it("remembers an address that found nothing and does not ask again", async () => {
    const fetch = vi.fn().mockResolvedValue(answer([]));
    await expect(geocode(IMPORTED, { fetch, wait })).resolves.toBeNull();
    const calls = fetch.mock.calls.length;
    expect(alreadyFailed(IMPORTED)).toBe(true);
    await expect(geocode(IMPORTED, { fetch, wait })).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it("throws on a refusal without remembering the address as a miss", async () => {
    const fetch = vi.fn().mockResolvedValue(answer({}, 429));
    await expect(geocode(IMPORTED, { fetch, wait })).rejects.toThrow("429");
    expect(alreadyFailed(IMPORTED)).toBe(false);
  });
});

describe("precisionOf", () => {
  it("reads a house as the door, a road as the street, anything wider as the area", () => {
    const street = { street: "Rua de Angola 25", city: "Lisboa" };
    expect(precisionOf(30, street)).toBe("exact");
    expect(precisionOf(26, street)).toBe("street");
    expect(precisionOf(21, street)).toBe("area");
    expect(precisionOf(undefined, street)).toBe("area");
  });

  it("calls whatever a postal code or a town finds an area, however precise its rank", () => {
    expect(precisionOf(30, { postalcode: "1170-020" })).toBe("area");
    expect(precisionOf(30, { city: "Lisboa" })).toBe("area");
  });
});

describe("locate", () => {
  beforeEach(() => resetGeocoderForTests());
  const wait = async () => {};

  it("says the postal-code fallback is only an area", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer([]))
      .mockResolvedValueOnce(answer([]))
      .mockResolvedValueOnce(
        answer([{ lat: "38.73", lon: "-9.13", place_rank: 25, display_name: "1170-020, Lisboa" }]),
      );
    await expect(locate(IMPORTED, { fetch, wait })).resolves.toEqual({
      latitude: 38.73,
      longitude: -9.13,
      precision: "area",
      displayName: "1170-020, Lisboa",
    });
  });

  it("says a house found by its street is the door", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(answer([{ lat: "38.7", lon: "-9.1", place_rank: 30, display_name: "x" }]));
    await expect(locate(IMPORTED, { fetch, wait })).resolves.toMatchObject({ precision: "exact" });
  });
});

describe("reverseGeocode", () => {
  beforeEach(() => resetGeocoderForTests());

  it("splits the address at a point as the form keeps it", async () => {
    const fetch = vi.fn().mockResolvedValue(
      answer({
        display_name: "25, Rua de Angola, Arroios, Lisboa, 1170-020, Portugal",
        address: { house_number: "25", road: "Rua de Angola", postcode: "1170020", city: "Lisboa" },
      }),
    );
    await expect(
      reverseGeocode({ latitude: 38.7, longitude: -9.1 }, { fetch, wait: async () => {} }),
    ).resolves.toEqual({
      streetAddress: "Rua de Angola 25",
      zipCode: "1170-020",
      city: "Lisboa",
      displayName: "25, Rua de Angola, Arroios, Lisboa, 1170-020, Portugal",
    });
    expect(String(fetch.mock.calls[0][0])).toContain("/reverse?");
  });

  it("answers null where Nominatim names nothing", async () => {
    const fetch = vi.fn().mockResolvedValue(answer({ error: "Unable to geocode" }));
    await expect(
      reverseGeocode({ latitude: 0, longitude: 0 }, { fetch, wait: async () => {} }),
    ).resolves.toBeNull();
  });

  it("takes the town where there is no city", () => {
    expect(toReverseAddress({ road: "Rua Direita", town: "Óbidos" }, "")).toMatchObject({
      streetAddress: "Rua Direita",
      city: "Óbidos",
      zipCode: "",
    });
  });
});
