import { describe, expect, it } from "vitest";
import { ownerSchema, updateOwnerSchema } from "./owner.schema";

/**
 * An owner's NIF is what AT names a landlord by on a receipt. Nothing stored it before: the schema
 * had no field for it, so no owner could have one and every receipt review said the landlord had
 * none.
 */

const owner = { name: "Ana Costa", email: "ana@example.pt" };

describe("ownerSchema, the NIF", () => {
  it("accepts an owner with no NIF, blank or null", () => {
    expect(ownerSchema.safeParse(owner).success).toBe(true);
    expect(ownerSchema.safeParse({ ...owner, taxIdentificationNumber: "" }).success).toBe(true);
    expect(ownerSchema.safeParse({ ...owner, taxIdentificationNumber: null }).success).toBe(true);
  });

  it.each(["123456789", "123 456 789", "502000007"])("accepts the NIF %j", (nif) => {
    expect(ownerSchema.safeParse({ ...owner, taxIdentificationNumber: nif }).success).toBe(true);
  });

  it("refuses nine digits whose check digit does not match, however they are spaced", () => {
    // 24567889 weighs 230, so its check digit is 1 and not the 9 it ends in.
    const result = ownerSchema.safeParse({ ...owner, taxIdentificationNumber: "245 678 899" });

    expect(result.success).toBe(false);
  });

  it("refuses a NIF whose check digit does not match, naming the field", () => {
    const result = ownerSchema.safeParse({ ...owner, taxIdentificationNumber: "123456788" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["taxIdentificationNumber"] });
  });

  it.each(["12345", "abcdefghi", "1234567890", "012345678"])("refuses %j as a NIF", (nif) => {
    expect(ownerSchema.safeParse({ ...owner, taxIdentificationNumber: nif }).success).toBe(false);
  });

  it("trims the input before it judges it", () => {
    const result = ownerSchema.safeParse({ ...owner, taxIdentificationNumber: "  123456789  " });

    expect(result.success).toBe(true);
    expect(result.data?.taxIdentificationNumber).toBe("123456789");
  });

  it("still requires the name and a valid email", () => {
    expect(ownerSchema.safeParse({ email: "ana@example.pt" }).success).toBe(false);
    expect(ownerSchema.safeParse({ name: "Ana", email: "nope" }).success).toBe(false);
  });
});

describe("ownerSchema, the email", () => {
  it.each([undefined, null, "", "   "])("takes an email of %j for none", (email) => {
    expect(ownerSchema.safeParse({ name: "Ana Costa", email }).success).toBe(true);
  });

  it("takes an owner with only a name", () => {
    expect(ownerSchema.safeParse({ name: "Ana Costa" }).success).toBe(true);
  });

  it("still refuses one that is not an address, with its message", () => {
    const result = ownerSchema.safeParse({ name: "Ana Costa", email: "nope" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Invalid email address");
  });
});

describe("updateOwnerSchema", () => {
  it("takes only what an edit changes", () => {
    expect(updateOwnerSchema.safeParse({}).success).toBe(true);
    expect(updateOwnerSchema.safeParse({ phone: "+351 912 345 678" }).success).toBe(true);
    expect(updateOwnerSchema.safeParse({ taxIdentificationNumber: "123456789" }).success).toBe(
      true,
    );
  });

  it("checks a NIF it is given, and a name it is given", () => {
    expect(updateOwnerSchema.safeParse({ taxIdentificationNumber: "123456788" }).success).toBe(
      false,
    );
    expect(updateOwnerSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("lets an edit clear the email", () => {
    expect(updateOwnerSchema.safeParse({ email: "" }).success).toBe(true);
    expect(updateOwnerSchema.safeParse({ email: null }).success).toBe(true);
    expect(updateOwnerSchema.safeParse({ email: "nope" }).success).toBe(false);
  });

  it("lets an edit clear the NIF", () => {
    expect(updateOwnerSchema.safeParse({ taxIdentificationNumber: "" }).success).toBe(true);
    expect(updateOwnerSchema.safeParse({ taxIdentificationNumber: null }).success).toBe(true);
  });
});
