import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { EXPENSE_CATEGORIES } from "@/lib/schemas/expense.schema";
import { expenseCategoryKey } from "./expense-labels";

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
});
