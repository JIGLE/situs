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
  return (
    EXPENSE_CATEGORIES.find((category) => category === key) ?? LEGACY_CATEGORIES[key] ?? undefined
  );
}

/**
 * Older, broader names and today's category for each. The demo seed and early data wrote
 * "Insurance" and "Taxes", which showed in English on a Portuguese screen.
 */
const LEGACY_CATEGORIES: Record<string, ExpenseCategory> = {
  insurance: "building_insurance",
  taxes: "other_tax",
  tax: "other_tax",
  mortgage: "mortgage_interest",
  management: "management_fees",
};

/**
 * The categories under seven headings, in the order the form lists them: a list of 26 in one
 * column was a long scroll on a phone. Every category is in exactly one group
 * (`expense-labels.test.ts`).
 */
export const EXPENSE_CATEGORY_GROUPS = {
  taxes: ["imi", "stamp_duty", "other_tax"],
  insurance: ["building_insurance", "contents_insurance", "liability_insurance"],
  condominium: [
    "condominium_fees",
    "stair_lighting",
    "cleaning",
    "gardening",
    "elevator",
    "security",
  ],
  works: ["repairs", "maintenance", "appliances"],
  utilities: ["water", "electricity", "gas", "internet", "utilities"],
  fees: [
    "mortgage_interest",
    "management_fees",
    "legal_fees",
    "accountant_fees",
    "software_hosting",
  ],
  other: ["other"],
} as const satisfies Record<string, readonly ExpenseCategory[]>;

export type ExpenseCategoryGroup = keyof typeof EXPENSE_CATEGORY_GROUPS;
export const EXPENSE_CATEGORY_GROUP_KEYS = Object.keys(
  EXPENSE_CATEGORY_GROUPS,
) as ExpenseCategoryGroup[];

/** The group a stored category belongs to; one the list does not know is "other". */
export function expenseCategoryGroup(raw: string | null | undefined): ExpenseCategoryGroup {
  const key = expenseCategoryKey(raw);
  if (!key) return "other";
  return (
    EXPENSE_CATEGORY_GROUP_KEYS.find((group) =>
      (EXPENSE_CATEGORY_GROUPS[group] as readonly string[]).includes(key),
    ) ?? "other"
  );
}

/**
 * The categories this owner used most, most used first, for the top of the form's list: most
 * owners record the same three or four costs every month.
 */
export function frequentCategories(
  stored: readonly { category: string }[],
  limit = 3,
): ExpenseCategory[] {
  const counts = new Map<ExpenseCategory, number>();
  for (const { category } of stored) {
    const key = expenseCategoryKey(category);
    if (key && key !== "other") counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}
