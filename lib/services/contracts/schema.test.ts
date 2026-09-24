import { describe, expect, it } from "vitest";
import { sampleExtraction } from "@/tests/fixtures/contract-extraction";
import { contractExtractionSchema, contractImportSchema, type ContractImport } from "./schema";
import { datesInOrder, nifInvalid, sharesTotalHundred } from "./review";

/**
 * The extraction schema is what the model's answer must be; the import schema is what the owner's
 * confirmed review must be, and the only one the import trusts. The review sheet runs the same
 * rules (review.ts) so each shows before Confirm.
 */

function confirmed(): ContractImport {
  return {
    property: {
      mode: "new",
      name: "Rua Augusta 12",
      address: "Rua Augusta 12, 3.º Esq., 1100-048 Lisboa",
      zipCode: "1100-048",
      city: "Lisboa",
      cadasterReference: "2321",
      fraction: "C",
      type: "apartment",
      bedrooms: 2,
      bathrooms: 1,
    },
    landlords: [
      {
        mode: "new",
        name: "Maria Fernandes",
        email: "maria@example.pt",
        taxId: "123456789",
        share: 50,
      },
      { mode: "existing", id: "owner-paulo", share: 50 },
    ],
    tenant: {
      mode: "new",
      name: "Ana Costa",
      email: "ana.costa@example.pt",
      phone: "+351 912 345 678",
      taxId: "246813571",
      taxCountry: "PT",
    },
    parties: [{ role: "guarantor", name: "Hans Weber", taxId: "DE 123", taxCountry: "DE" }],
    lease: {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      monthlyRent: 950,
      deposit: 1900,
      autoRenew: true,
      renewalNoticeDays: 120,
      atContractNumber: "20240012345",
      atContractVersion: 1,
    },
    clauses: [
      { kind: "renewal", summary: "Renova-se.", quote: "Renova-se automaticamente.", page: 2 },
    ],
  };
}

const issuesOf = (value: unknown) => {
  const result = contractImportSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("contractExtractionSchema", () => {
  it("takes a full reading, and refuses a clause kind or a date it does not know", () => {
    expect(contractExtractionSchema.safeParse(sampleExtraction).success).toBe(true);

    const badClause = {
      ...sampleExtraction,
      clauses: [{ kind: "penalty", summary: "x", quote: "y", page: 1 }],
    };
    expect(contractExtractionSchema.safeParse(badClause).success).toBe(false);

    const badDate = {
      ...sampleExtraction,
      terms: { ...sampleExtraction.terms, startDate: { value: "1 January 2026", source: null } },
    };
    expect(contractExtractionSchema.safeParse(badDate).success).toBe(false);
  });
});

describe("contractImportSchema", () => {
  it("takes a complete review", () => {
    expect(issuesOf(confirmed())).toEqual([]);
  });

  it("refuses a lease that ends before it starts", () => {
    const review = confirmed();
    review.lease.endDate = "2025-12-31";
    expect(issuesOf(review)).toEqual(["lease.endDate: End date before start"]);
  });

  it("refuses shares that do not make a whole property, and takes thirds", () => {
    const review = confirmed();
    review.landlords[1].share = 40;
    expect(issuesOf(review)).toEqual(["landlords: Shares must total 100%"]);

    const thirds = confirmed();
    thirds.landlords = [
      { mode: "existing", id: "a", share: 33.33 },
      { mode: "existing", id: "b", share: 33.33 },
      { mode: "existing", id: "c", share: 33.33 },
    ];
    expect(issuesOf(thirds)).toEqual([]);
  });

  it("wants an email for a new tenant and a new landlord, and a Portuguese NIF that checks", () => {
    const review = confirmed() as unknown as {
      tenant: Record<string, unknown>;
      landlords: Array<Record<string, unknown>>;
    };
    review.tenant.email = "";
    review.landlords[0].taxId = "123456780";

    expect(issuesOf(review)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^tenant\.email:/),
        "landlords.0.taxId: Invalid NIF",
      ]),
    );
  });
});

describe("review rules", () => {
  it("share, date and NIF checks", () => {
    expect(sharesTotalHundred([{ share: 60 }, { share: 40 }])).toBe(true);
    expect(sharesTotalHundred([{ share: 60 }, { share: null }])).toBe(false);
    expect(datesInOrder("2026-01-01", "2026-12-31")).toBe(true);
    expect(datesInOrder("2026-01-01", "2026-01-01")).toBe(false);
    expect(datesInOrder("2026-01-01", "")).toBe(false);
    expect(nifInvalid("123456780", "PT")).toBe(true);
    expect(nifInvalid("123 456 789", null)).toBe(false);
    expect(nifInvalid("DE 123", "DE")).toBe(false);
    expect(nifInvalid("", "PT")).toBe(false);
  });
});
