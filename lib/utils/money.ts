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

/**
 * An amount as typed, in any of the app's locales: "3200,00", "3.200,00", "3,200.00", "3200.5",
 * "3.200" or "3 200". With both separators the last one is the decimal point; a lone comma is one too,
 * since Portuguese, Spanish and Italian write it so. NaN for anything else. A `type="number"`
 * field could not take "3200,00" in every browser, which is how the owner writes it.
 */
export function parseAmountInput(raw: string): number {
  const text = raw.replace(/[\s €]/g, "");
  if (!/^\d[\d.,]*$/.test(text)) return Number.NaN;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  // A dot with no comma and three digits after it is Portuguese thousands ("3.200"), since
  // nobody writes 3,2 € with three decimals.
  const dotIsThousands = lastComma < 0 && lastDot >= 0 && /\.\d{3}$/.test(text);
  const decimal = lastComma > lastDot || dotIsThousands ? "," : ".";
  const thousands = decimal === "," ? "." : ",";
  const [whole, ...fraction] = text.split(thousands).join("").split(decimal);
  if (fraction.length > 1) return Number.NaN;
  return Number(fraction.length ? `${whole}.${fraction[0]}` : whole);
}
