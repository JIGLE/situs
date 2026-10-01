import { describe, expect, it } from "vitest";
import { propertySchema, updatePropertySchema } from "./property.schema";

const property = {
  name: "Rua Augusta 1, 2º Esq",
  address: "Rua Augusta 1, Lisboa",
  type: "apartment",
  bedrooms: 2,
  bathrooms: 1,
  rent: 950,
  status: "vacant",
} as const;

describe("propertySchema postal code", () => {
  it.each(["", "1100-048"])("accepts %j", (zipCode) => {
    expect(propertySchema.safeParse({ ...property, zipCode }).success).toBe(true);
  });

  it("rejects a code that is not in the Portuguese NNNN-NNN form", () => {
    expect(propertySchema.safeParse({ ...property, zipCode: "28001" }).success).toBe(false);
  });

  it("rejects a malformed one with its own message", () => {
    const result = propertySchema.safeParse({ ...property, zipCode: "12" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Invalid postal code format");
  });
});

describe("updatePropertySchema", () => {
  it("adds nothing to a partial update, so an edit cannot reset a field it left out", () => {
    expect(updatePropertySchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });

  it("still fills the defaults when a property is created", () => {
    expect(propertySchema.parse(property)).toMatchObject({ addressVerified: false });
  });
});

/**
 * Finanças does not say how many rooms a property has. Unknown is null, not 0: 0 is a studio.
 */
describe("propertySchema, the rooms", () => {
  it.each([undefined, null])("takes bedrooms and bathrooms of %j for unknown", (rooms) => {
    const result = propertySchema.safeParse({ ...property, bedrooms: rooms, bathrooms: rooms });

    expect(result.success).toBe(true);
    expect(result.data?.bedrooms).toBe(rooms);
  });

  it("keeps 0, which is a studio, and not unknown", () => {
    expect(propertySchema.parse({ ...property, bedrooms: 0 }).bedrooms).toBe(0);
  });

  it.each([-1, 21])("still refuses %j rooms", (rooms) => {
    expect(propertySchema.safeParse({ ...property, bedrooms: rooms }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, bathrooms: rooms }).success).toBe(false);
  });

  it("lets an edit set the rooms back to unknown", () => {
    expect(updatePropertySchema.parse({ bedrooms: null })).toEqual({ bedrooms: null });
  });
});
