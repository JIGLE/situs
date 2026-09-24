import { EXPENSE_CATEGORIES } from "@/lib/schemas/expense.schema";

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * A stored expense category as its key under `financial.categories`, or undefined when it is not
 * one of today's categories (older data, a renamed key) — asking the catalogue for a key it lacks
 * logs an error and renders the key path, so callers show those some other way.
 *
 * Normalised first, because stored values are not always the enum's spelling: the demo seed wrote
 * "Mortgage Interest", which is `mortgage_interest`. Two views label categories; both use this.
 */
export function expenseCategoryKey(raw: string | null | undefined): ExpenseCategory | undefined {
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  return EXPENSE_CATEGORIES.find((category) => category === key);
}
