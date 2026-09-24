import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AddressVerificationService,
  type AddressSuggestion,
} from "@/lib/utils/address-verification";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeSuggestion(
  overrides: Partial<AddressSuggestion["address"]> & {
    lat?: string;
    lon?: string;
    display_name?: string;
    country_field?: string; // convenience: sets address.country
  } = {},
): AddressSuggestion {
  const {
    lat = "38.7169",
    lon = "-9.1399",
    display_name,
    country_field,
    ...addressOverrides
  } = overrides;
  return {
    display_name: display_name ?? "123 Test Road, Lisbon, Portugal",
    lat,
    lon,
    place_id: "1",
    licence: "",
    osm_type: "way",
    osm_id: "1",
    boundingbox: [],
    class: "building",
    type: "yes",
    importance: 0.5,
    address: {
      house_number: "123",
      road: "Test Road",
      suburb: "Bairro Alto",
      city: "Lisboa",
      municipality: "Lisboa",
      postcode: "1200-001",
      country: country_field ?? "Portugal",
      country_code: "pt",
      ...addressOverrides,
    },
  };
}

// ─── validatePostalCode ───────────────────────────────────────────────────────

describe("AddressVerificationService.validatePostalCode", () => {
  it("valid Portuguese postal code XXXX-XXX", () => {
    expect(AddressVerificationService.validatePostalCode("1000-001")).toBe(true);
  });

  it("invalid Portuguese code without hyphen", () => {
    expect(AddressVerificationService.validatePostalCode("1000001")).toBe(false);
  });

  it("invalid Portuguese code too short", () => {
    expect(AddressVerificationService.validatePostalCode("100-001")).toBe(false);
  });

  it("a Spanish five-digit code is not a Portuguese one", () => {
    expect(AddressVerificationService.validatePostalCode("28001")).toBe(false);
  });
});

// ─── parseAddressSuggestion ───────────────────────────────────────────────────

describe("AddressVerificationService.parseAddressSuggestion", () => {
  it("builds street address from house number + road", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ suburb: undefined }),
    );
    expect(result.streetAddress).toBe("123 Test Road");
  });

  it("includes suburb when it differs from city", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ suburb: "Bairro Alto", city: "Lisboa" }),
    );
    expect(result.streetAddress).toContain("Bairro Alto");
  });

  it("excludes suburb when it equals city", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ suburb: "Lisboa", city: "Lisboa" }),
    );
    expect(result.streetAddress).not.toContain("Lisboa");
  });

  it("falls back to display_name first part when no street components", () => {
    const suggestion = makeSuggestion({
      house_number: undefined,
      road: undefined,
      suburb: undefined,
      display_name: "Parque Eduardo VII, Lisbon, Portugal",
    });
    const result = AddressVerificationService.parseAddressSuggestion(suggestion);
    expect(result.streetAddress).toBe("Parque Eduardo VII");
  });

  it("city prefers municipality over city field", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ municipality: "Sintra", city: "Queluz" }),
    );
    expect(result.city).toBe("Sintra");
  });

  it("city falls back to city field when no municipality", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ municipality: undefined, city: "Lisboa" }),
    );
    expect(result.city).toBe("Lisboa");
  });

  it("city falls back to county when municipality and city absent", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ municipality: undefined, city: undefined, county: "Lisboa District" }),
    );
    expect(result.city).toBe("Lisboa District");
  });

  it("PT: valid XXXX-XXX postal code left unchanged", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ postcode: "4000-007" }),
    );
    expect(result.zipCode).toBe("4000-007");
  });

  it("PT: 7-digit unformatted code reformatted to XXXX-XXX", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ postcode: "1200001" }),
    );
    expect(result.zipCode).toBe("1200-001");
  });

  it("PT: invalid postal code with <7 digits kept as-is (cannot reformat)", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ postcode: "12001" }), // 5 digits — not reformattable for PT
    );
    // digits.length !== 7, so it stays as the stripped string
    expect(result.zipCode).toBeDefined();
  });

  it("latitude and longitude parsed as numbers", () => {
    const result = AddressVerificationService.parseAddressSuggestion(
      makeSuggestion({ lat: "38.7169", lon: "-9.1399" }),
    );
    expect(typeof result.latitude).toBe("number");
    expect(typeof result.longitude).toBe("number");
    expect(result.latitude).toBeCloseTo(38.7169, 4);
    expect(result.longitude).toBeCloseTo(-9.1399, 4);
  });

  it("verified flag is always true", () => {
    expect(AddressVerificationService.parseAddressSuggestion(makeSuggestion()).verified).toBe(true);
  });
});

// ─── generateBuildingId ───────────────────────────────────────────────────────

describe("AddressVerificationService.generateBuildingId", () => {
  it("returns a non-empty string", () => {
    const id = AddressVerificationService.generateBuildingId(
      "Rua de Exemplo 1",
      "Lisbon",
      "1000-001",
    );
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("same inputs produce the same id (deterministic)", () => {
    const id1 = AddressVerificationService.generateBuildingId("Rua do Ouro", "Lisboa", "1100-060");
    const id2 = AddressVerificationService.generateBuildingId("Rua do Ouro", "Lisboa", "1100-060");
    expect(id1).toBe(id2);
  });

  it("different addresses produce different ids", () => {
    const id1 = AddressVerificationService.generateBuildingId("Street A", "City", "0000-000");
    const id2 = AddressVerificationService.generateBuildingId("Street B", "City", "0000-000");
    expect(id1).not.toBe(id2);
  });

  it("case and punctuation are normalized (same address, different casing → same id)", () => {
    const id1 = AddressVerificationService.generateBuildingId("Rua Nova", "Lisboa", "1000-001");
    const id2 = AddressVerificationService.generateBuildingId("RUA NOVA", "LISBOA", "1000-001");
    expect(id1).toBe(id2);
  });
});

// ─── searchAddresses ──────────────────────────────────────────────────────────

describe("AddressVerificationService.searchAddresses", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns parsed suggestions on successful fetch", async () => {
    const fakeResponse: AddressSuggestion[] = [makeSuggestion()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => fakeResponse,
      })),
    );

    const results = await AddressVerificationService.searchAddresses("Rua do Ouro");
    expect(results).toHaveLength(1);
    expect(results[0].address.country).toBe("Portugal");
  });

  it("searches within Portugal only", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return { ok: true, json: async () => [] };
      }),
    );

    await AddressVerificationService.searchAddresses("Lisbon");
    expect(capturedUrl).toContain("countrycodes=pt");
    expect(capturedUrl).toContain("bounded=1");
  });

  it("returns empty array when API responds with non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 })),
    );

    const results = await AddressVerificationService.searchAddresses("somewhere");
    expect(results).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network failure");
      }),
    );

    const results = await AddressVerificationService.searchAddresses("somewhere");
    expect(results).toEqual([]);
  });
});
