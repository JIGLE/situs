import { describe, expect, it } from "vitest";
import { Currency } from "@prisma/client";
import { CURRENCIES, updateSettingsSchema } from "./settings.schema";

describe("settings schema", () => {
  it("accepts exactly the currencies the database enum holds", () => {
    expect([...CURRENCIES].sort()).toEqual(Object.values(Currency).sort());
  });

  it("adds nothing to a partial update", () => {
    expect(updateSettingsSchema.parse({ defaultCurrency: "EUR" })).toEqual({
      defaultCurrency: "EUR",
    });
  });
});
