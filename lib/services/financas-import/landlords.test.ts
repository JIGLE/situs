import { describe, expect, it } from "vitest";
import { describeShares, planShares } from "./landlords";

// Valid NIFs (check digit), made up.
const A = "123456789";
const B = "287654320";
const C = "298765438";

describe("planShares", () => {
  it("matches owners by NIF and keeps the printed parts", () => {
    const plan = planShares(
      [
        { taxId: A, name: "JOSÉ EXEMPLO", share: "1/2" },
        { taxId: B, name: "ANA DA SILVA", share: "1/2" },
      ],
      [{ id: "o1", name: "José Exemplo", taxIdentificationNumber: "PT 123 456 789" }],
    );
    expect(plan).toEqual([
      { ownerId: "o1", name: "José Exemplo", taxId: A, percentage: 50 },
      { ownerId: null, name: "Ana da Silva", taxId: B, percentage: 50 },
    ]);
  });

  it("gives the rent to the usufructuary, not the bare owners", () => {
    const plan = planShares(
      [
        { taxId: A, name: "MÃE", share: "1/1", kind: "usufruct" },
        { taxId: B, name: "FILHO", share: "1/2", kind: "bare" },
        { taxId: C, name: "FILHA", share: "1/2", kind: "bare" },
      ],
      [],
    );
    expect(plan.map((p) => [p.name, p.percentage])).toEqual([["Mãe", 100]]);
  });

  it("splits equally when the parts are missing or do not make a whole", () => {
    expect(
      planShares(
        [
          { taxId: A, name: "A", share: null },
          { taxId: B, name: "B", share: "1/2" },
        ],
        [],
      ).map((p) => p.percentage),
    ).toEqual([50, 50]);
    expect(
      planShares(
        [
          { taxId: A, name: "A", share: "1/3" },
          { taxId: B, name: "B", share: "1/3" },
          { taxId: C, name: "C", share: "1/3" },
        ],
        [],
      ).reduce((sum, p) => sum + p.percentage, 0),
    ).toBeCloseTo(100);
  });

  it("adds the parts of someone listed twice, and drops a NIF that fails its check", () => {
    const plan = planShares(
      [
        { taxId: A, name: "A", share: "1/4" },
        { taxId: A, name: "A", share: "1/4" },
        { taxId: "111111111", name: "B", share: "1/2" },
      ],
      [],
    );
    expect(plan).toEqual([
      { ownerId: null, name: "A", taxId: A, percentage: 50 },
      { ownerId: null, name: "B", taxId: null, percentage: 50 },
    ]);
  });

  it("describes the plan in the app's language", () => {
    expect(
      describeShares(
        [
          { ownerId: null, name: "Ana", taxId: null, percentage: 100 / 3 },
          { ownerId: null, name: "Rui", taxId: null, percentage: 200 / 3 },
        ],
        "pt-PT",
      ),
    ).toBe("Ana 33,33% · Rui 66,67%");
  });
});
