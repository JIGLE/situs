import { beforeEach, describe, expect, it, vi } from "vitest";
import { geocode, geocodeQueries, resetGeocoderForTests, alreadyFailed } from "./nominatim";

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
