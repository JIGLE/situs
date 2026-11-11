import { describe, expect, it } from "vitest";
import type { ParsedContract } from "./contract";
import { propertiesMatching, tenancyFromContract } from "./match";

const contract = (over: Partial<ParsedContract> = {}): ParsedContract => ({
  recognised: true,
  contractNumber: "1234567",
  startDate: "2025-02-01",
  endDate: "2027-01-31",
  renewable: true,
  purpose: null,
  monthlyRent: 850,
  rentNotMonthly: false,
  article: "1234",
  fraction: "2º Esq",
  parish: null,
  landlords: [],
  tenants: [
    { taxId: "287654321", name: "MARIA DA SILVA", country: "PORTUGAL", share: null },
    { taxId: "298765432", name: "PEDRO SANTOS", country: null, share: null },
  ],
  ...over,
});

const properties = [
  { id: "p1", cadasterReference: "1234", fraction: "2.º ESQ" },
  { id: "p2", cadasterReference: "1234", fraction: "C" },
  { id: "p3", cadasterReference: "0098", fraction: null },
];

describe("propertiesMatching", () => {
  it("compares articles and fractions the way people write them", () => {
    expect(propertiesMatching(properties, "1234", "2º Esq").map((p) => p.id)).toEqual(["p1"]);
    expect(propertiesMatching(properties, "98", "").map((p) => p.id)).toEqual(["p3"]);
    expect(propertiesMatching(properties, "1234", null)).toEqual([]);
    expect(propertiesMatching(properties, null, "C")).toEqual([]);
  });
});

describe("tenancyFromContract", () => {
  it("fills the tenancy and names the first tenant new, the others co-tenants", () => {
    expect(tenancyFromContract(contract(), properties, [], "2026-11-11")).toEqual({
      propertyId: "p1",
      tenant: { name: "Maria da Silva", taxId: "287654321" },
      coTenants: [{ name: "Pedro Santos", taxId: "298765432" }],
      startDate: "2025-02-01",
      endDate: "2027-01-31",
      monthlyRent: 850,
      atContractNumber: "1234567",
      warnings: [],
    });
  });

  it("picks a tenant already in Situs by NIF", () => {
    const result = tenancyFromContract(
      contract(),
      properties,
      [{ id: "t9", taxId: "287654321" }],
      "2026-11-11",
    );
    expect(result.tenant).toEqual({ existingId: "t9" });
  });

  it("says what the owner must fill in or check", () => {
    const result = tenancyFromContract(
      contract({
        article: "5555",
        tenants: [],
        monthlyRent: null,
        startDate: null,
        endDate: "2024-01-31",
        rentNotMonthly: true,
      }),
      properties,
      [],
      "2026-11-11",
    );
    expect(result.propertyId).toBeNull();
    expect(result.tenant).toBeNull();
    expect(result.warnings).toEqual([
      "property_not_found",
      "no_tenant",
      "no_rent",
      "rent_not_monthly",
      "no_start",
      "term_passed",
    ]);
  });

  it("leaves the property unchosen when two share the article and fraction", () => {
    const twins = [...properties, { id: "p4", cadasterReference: "1234", fraction: "2ESQ" }];
    const result = tenancyFromContract(contract(), twins, [], "2026-11-11");
    expect(result.propertyId).toBeNull();
    expect(result.warnings).toContain("property_ambiguous");
  });
});
