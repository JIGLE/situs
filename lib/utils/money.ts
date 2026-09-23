/**
 * Monetary helpers.
 *
 * Every money column in this schema is a Prisma `Float` — IEEE-754 binary floating point,
 * which cannot represent 0.1 or 0.01 exactly. That is a deliberate decision, recorded in the
 * ROADMAP.md Decisions Log (2026-08-13): the allocation engine defends itself, and migrating every
 * money column to integer minor units across every money-handling service on a live instance is
 * a redesign, not a fix.
 *
 * The cost of that decision is that the discipline has to be applied by hand. Repeated
 * addition accumulates representation error — `0.1 + 0.2 === 0.30000000000000004` — so a
 * column of receipts summed naively drifts by fractions of a cent, and drift in a number a
 * landlord files with a tax authority is not acceptable in the way dashboard drift is.
 *
 * These live here rather than inside the allocation engine so that tax and reporting code can
 * use them without importing from the rent-allocation domain.
 */

/** Half a cent: the largest error two correctly-rounded EUR amounts can differ by. */
export const MONEY_EPSILON = 0.005;

/** Round to cents. Apply at every aggregation boundary, not between intermediate steps. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum monetary values, rounding once at the end.
 *
 * Rounding once at the boundary rather than per-item is deliberate: rounding each addend
 * first would introduce its own bias, and every input here is already stored at cent
 * precision.
 */
export function sumMoney(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}
