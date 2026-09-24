import { describe, expect, it } from "vitest";
import { sampleExtraction } from "@/tests/fixtures/contract-extraction";
import { matchContract, type MatchCandidates } from "./match";

/**
 * Which of the owner's records a contract refers to. A wrong match would file the lease against
 * someone else's flat or tenant, so each rule is pinned both ways: what it finds, and what it must
 * not.
 */

const none: MatchCandidates = { properties: [], owners: [], tenants: [] };

describe("matchContract", () => {
  it("marks everything new when the owner has no such records", () => {
    expect(matchContract(sampleExtraction, none)).toEqual({
      property: null,
      landlords: [null, null],
      tenants: [null, null],
    });
  });

  it("finds the property by its matriz article and fraction, and not another fraction's", () => {
    const flat = (id: string, fraction: string | null) => ({
      id,
      address: "Somewhere else entirely",
      cadasterReference: "2321",
      fraction,
    });

    expect(
      matchContract(sampleExtraction, { ...none, properties: [flat("b", "B"), flat("c", "c")] })
        .property,
    ).toEqual({ id: "c", by: "matrix" });
    expect(
      matchContract(sampleExtraction, { ...none, properties: [flat("b", "B")] }).property,
    ).toBeNull();
  });

  it("falls back to the address, word for word, ignoring accents and punctuation", () => {
    const at = (id: string, address: string, fraction: string | null = null) => ({
      id,
      address,
      cadasterReference: null,
      fraction,
    });

    expect(
      matchContract(sampleExtraction, {
        ...none,
        properties: [at("p", "RUA AUGUSTA 12, 3º ESQ, 1100-048 LISBOA")],
      }).property,
    ).toEqual({ id: "p", by: "address" });
    // "Rua Augusta 1" is another building, and fraction A another flat.
    const reading = {
      ...sampleExtraction,
      property: { ...sampleExtraction.property, address: "Rua Augusta 1", matrixArticle: null },
    };
    expect(
      matchContract(reading, { ...none, properties: [at("p", "Rua Augusta 12, Lisboa")] }).property,
    ).toBeNull();
    expect(
      matchContract(sampleExtraction, {
        ...none,
        properties: [at("p", "Rua Augusta 12, 3.º Esq., Lisboa", "A")],
      }).property,
    ).toBeNull();
  });

  it("finds landlords and tenants by NIF, however it is spaced, then by email", () => {
    const matches = matchContract(sampleExtraction, {
      ...none,
      owners: [
        { id: "maria", email: "maria@example.pt", taxIdentificationNumber: "123 456 789" },
        { id: "someone", email: "paulo@example.pt", taxIdentificationNumber: null },
      ],
      tenants: [
        { id: "ana", email: "ANA.COSTA@example.pt", taxId: null, taxCountry: "PT" },
        { id: "rui", email: "rui@example.pt", taxId: "450000001", taxCountry: "PT" },
      ],
    });

    expect(matches.landlords).toEqual([{ id: "maria", by: "nif" }, null]);
    expect(matches.tenants).toEqual([
      { id: "ana", by: "email" },
      { id: "rui", by: "nif" },
    ]);
  });
});
