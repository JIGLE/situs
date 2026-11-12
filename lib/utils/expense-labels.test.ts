import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { EXPENSE_CATEGORIES } from "@/lib/schemas/expense.schema";
import {
  EXPENSE_CATEGORY_GROUPS,
  expenseCategoryGroup,
  expenseCategoryKey,
  frequentCategories,
} from "./expense-labels";

describe("expenseCategoryKey", () => {
  it("finds a category stored in another spelling", () => {
    expect(expenseCategoryKey("Mortgage Interest")).toBe("mortgage_interest");
    expect(expenseCategoryKey("Repairs")).toBe("repairs");
  });

  it("returns nothing for a category that is not one of today's", () => {
    expect(expenseCategoryKey("pool_cleaning")).toBeUndefined();
    expect(expenseCategoryKey("")).toBeUndefined();
    expect(expenseCategoryKey(null)).toBeUndefined();
  });

  it("labels every category the schema accepts", () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(en.financial.categories[category]).toEqual(expect.any(String));
    }
  });

  it("reads the older, broader names as today's categories", () => {
    expect(expenseCategoryKey("Insurance")).toBe("building_insurance");
    expect(expenseCategoryKey("Taxes")).toBe("other_tax");
  });
});

describe("EXPENSE_CATEGORY_GROUPS", () => {
  it("holds every category exactly once", () => {
    const grouped = Object.values(EXPENSE_CATEGORY_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...EXPENSE_CATEGORIES].sort());
  });

  it("names a heading for every group in every catalogue", () => {
    for (const group of Object.keys(EXPENSE_CATEGORY_GROUPS)) {
      expect(en.financial.categoryGroups[group as keyof typeof EXPENSE_CATEGORY_GROUPS]).toEqual(
        expect.any(String),
      );
    }
  });

  it("puts a stored category under its heading", () => {
    expect(expenseCategoryGroup("condominium_fees")).toBe("condominium");
    expect(expenseCategoryGroup("Taxes")).toBe("taxes");
    expect(expenseCategoryGroup("pool_cleaning")).toBe("other");
  });
});

describe("frequentCategories", () => {
  it("lists the most used first and leaves out other", () => {
    const stored = [
      "water",
      "condominium_fees",
      "condominium_fees",
      "other",
      "other",
      "other",
      "imi",
    ].map((category) => ({ category }));
    expect(frequentCategories(stored, 2)).toEqual(["condominium_fees", "water"]);
  });
});
