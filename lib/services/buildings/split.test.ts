import { describe, expect, it } from "vitest";
import { splitBasisFor, splitBuildingExpense } from "./split";

const sum = (parts: { amount: number }[]) =>
  Math.round(parts.reduce((s, p) => s + p.amount * 100, 0)) / 100;

describe("splitBuildingExpense", () => {
  it("splits by permilagem when every unit has one", () => {
    const { basis, parts } = splitBuildingExpense(1000, [
      { propertyId: "a", permilage: 250 },
      { propertyId: "b", permilage: 350 },
      { propertyId: "c", permilage: 400 },
    ]);
    expect(basis).toBe("permilage");
    expect(parts).toEqual([
      { propertyId: "a", amount: 250 },
      { propertyId: "b", amount: 350 },
      { propertyId: "c", amount: 400 },
    ]);
  });

  it("splits by the units' own permilagens when they do not reach 1000", () => {
    // Two frações of a larger condomínio: each pays in proportion to the other.
    const { parts } = splitBuildingExpense(90, [
      { propertyId: "a", permilage: 40 },
      { propertyId: "b", permilage: 80 },
    ]);
    expect(parts.map((p) => p.amount)).toEqual([30, 60]);
  });

  it("splits in equal parts when any unit has no permilagem", () => {
    const { basis, parts } = splitBuildingExpense(100, [
      { propertyId: "a", permilage: 500 },
      { propertyId: "b", permilage: null },
      { propertyId: "c", permilage: 0 },
    ]);
    expect(basis).toBe("equal");
    expect(parts.map((p) => p.amount)).toEqual([33.34, 33.33, 33.33]);
  });

  it("adds up to the cent, the odd cents going to the largest remainders", () => {
    const { parts } = splitBuildingExpense(100.01, [
      { propertyId: "a", permilage: 333 },
      { propertyId: "b", permilage: 333 },
      { propertyId: "c", permilage: 334 },
    ]);
    expect(sum(parts)).toBe(100.01);
    for (const amount of [0.1, 7.77, 1234.56, 0.01]) {
      const split = splitBuildingExpense(amount, [
        { propertyId: "a", permilage: 123.4 },
        { propertyId: "b", permilage: 456.7 },
        { propertyId: "c", permilage: 419.9 },
      ]);
      expect(sum(split.parts)).toBe(amount);
    }
  });

  it("has no parts and no basis to speak of with no units", () => {
    expect(splitBuildingExpense(50, [])).toEqual({ basis: "equal", parts: [] });
    expect(splitBasisFor([])).toBe("equal");
  });
});
