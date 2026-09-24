import { describe, expect, it } from "vitest";
import { sampleExtraction } from "@/tests/fixtures/contract-extraction";
import { contractImportSchema } from "./schema";
import { draftFromReading, draftProblems, draftToImport, NEW, type ContractDraft } from "./draft";

/**
 * The review sheet's three steps, without the sheet: a reading becomes a draft, the draft names
 * what blocks Confirm, and a clean draft becomes exactly what the import route accepts.
 */

const noMatches = { property: null, landlords: [null, null], tenants: [null, null] };

function draft(): ContractDraft {
  const d = draftFromReading(sampleExtraction, noMatches);
  // The contract gives no landlord emails; the owner types them in.
  d.landlords[0].email = "maria@example.pt";
  d.landlords[1].email = "paulo@example.pt";
  return d;
}

describe("draftFromReading", () => {
  it("fills the form from the reading, and links what matched", () => {
    const d = draftFromReading(sampleExtraction, {
      property: { id: "property-1", by: "matrix" },
      landlords: [{ id: "owner-maria", by: "nif" }, null],
      tenants: [{ id: "tenant-ana", by: "email" }, null],
    });

    expect(d.property).toMatchObject({
      recordId: "property-1",
      cadasterReference: "2321",
      fraction: "C",
      bedrooms: "2",
    });
    expect(d.landlords.map((l) => [l.recordId, l.share])).toEqual([
      ["owner-maria", "50"],
      [NEW, "50"],
    ]);
    expect(d.tenant).toMatchObject({ recordId: "tenant-ana", taxId: "246813571" });
    // The second tenant and the guarantor are the lease's other parties.
    expect(d.parties.map((p) => [p.role, p.name])).toEqual([
      ["tenant", "Rui Costa"],
      ["guarantor", "Hans Weber"],
    ]);
    expect(d.terms).toMatchObject({
      startDate: "2026-01-01",
      monthlyRent: "950",
      atContractNumber: "20240012345",
      atContractVersion: "1",
    });
  });

  it("gives a sole landlord the whole property, and leaves co-owners' unstated shares empty", () => {
    const sole = {
      ...sampleExtraction,
      landlords: [{ ...sampleExtraction.landlords[0], share: null }],
    };
    expect(draftFromReading(sole, { ...noMatches, landlords: [null] }).landlords[0].share).toBe(
      "100",
    );

    const unstated = {
      ...sampleExtraction,
      landlords: sampleExtraction.landlords.map((l) => ({ ...l, share: null })),
    };
    expect(draftFromReading(unstated, noMatches).landlords.map((l) => l.share)).toEqual(["", ""]);
  });
});

describe("draftProblems", () => {
  it("has none for a complete review", () => {
    expect(draftProblems(draft())).toEqual([]);
  });

  it("names each thing to fix before Confirm", () => {
    const d = draft();
    d.landlords[1].share = "40";
    d.landlords[1].email = "";
    d.terms.endDate = "2025-01-01";
    d.parties[0].taxId = "123456780";

    expect(draftProblems(d)).toEqual(
      expect.arrayContaining([
        { kind: "shares", total: 90 },
        { kind: "email", name: "Paulo Fernandes" },
        { kind: "dates" },
        { kind: "nif", name: "Rui Costa" },
      ]),
    );
  });

  it("asks for nothing of a record that already exists", () => {
    const d = draft();
    d.tenant = { ...d.tenant, recordId: "tenant-ana", email: "", name: "" };
    expect(draftProblems(d)).toEqual([]);
  });
});

describe("draftToImport", () => {
  it("produces a review the import route accepts", () => {
    const review = draftToImport(draft());

    expect(contractImportSchema.safeParse(review).success).toBe(true);
    expect(review.lease).toMatchObject({ monthlyRent: 950, deposit: 1900, atContractVersion: 1 });
    expect(review.tenant).toMatchObject({ mode: "new", phone: "+351 912 345 678" });
  });
});
