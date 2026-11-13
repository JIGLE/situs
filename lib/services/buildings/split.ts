/**
 * How a building's expense is shared by its units: by each fração's permilagem where every unit
 * in the split has one, and in equal parts otherwise (Jose's choice, 2026-11-13). The parts are in
 * cents and add up to the expense to the cent: the cents left over by rounding go, one each, to
 * the units with the largest remainders, ties to the earlier unit.
 *
 * Each part is then an ordinary expense of its unit, which the co-owners' shares split by their
 * recorded percentages (`lib/services/owner-payouts/split.ts`). Pure.
 */

export type SplitBasis = "permilage" | "equal";

export interface SplitUnit {
  propertyId: string;
  /** The fração's permilagem; null or 0 when not known. */
  permilage: number | null | undefined;
}

export interface SplitPart {
  propertyId: string;
  amount: number;
}

/** Whether these units are split by permilagem: every one of them has one. */
export function splitBasisFor(units: readonly SplitUnit[]): SplitBasis {
  return units.length > 0 && units.every((u) => (u.permilage ?? 0) > 0) ? "permilage" : "equal";
}

export function splitBuildingExpense(
  amount: number,
  units: readonly SplitUnit[],
): { basis: SplitBasis; parts: SplitPart[] } {
  const basis = splitBasisFor(units);
  if (units.length === 0) return { basis, parts: [] };

  const weights = units.map((u) => (basis === "permilage" ? (u.permilage as number) : 1));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const cents = Math.round(amount * 100);
  const exact = weights.map((w) => (cents * w) / totalWeight);
  const floors = exact.map((x) => Math.floor(x));
  let left = cents - floors.reduce((sum, c) => sum + c, 0);
  const order = exact
    .map((x, i) => ({ i, remainder: x - floors[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return {
    basis,
    parts: units.map((u, i) => ({ propertyId: u.propertyId, amount: floors[i] / 100 })),
  };
}
