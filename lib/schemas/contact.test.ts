import { describe, expect, it } from "vitest";
import { optionalEmail } from "./contact";

/**
 * Finanças names a landlord or a tenant by NIF and name, and Situs reads them from there before
 * anyone has typed an address. A blank input sends "", and a record read back from the API carries
 * null for an empty column: both are none, and an edit form that loads a record as it is must still
 * validate. Anything else has to be an address.
 */
describe("optionalEmail", () => {
  const schema = optionalEmail("Invalid email address");

  it.each([undefined, null, "", "   "])("takes %j for none", (none) => {
    expect(schema.safeParse(none).success).toBe(true);
  });

  it("takes an address, with or without spaces round it", () => {
    expect(schema.safeParse("ana@example.com").success).toBe(true);
    expect(schema.safeParse("  ana@example.com ").success).toBe(true);
  });

  it.each(["nope", "ana@", "@example.com", "ana example@x.pt"])(
    "refuses %j, with the message it was given",
    (typo) => {
      const result = schema.safeParse(typo);

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe("Invalid email address");
    },
  );

  it("refuses an address longer than 255 characters", () => {
    const long = `${"a".repeat(250)}@example.com`;

    expect(schema.safeParse(long).success).toBe(false);
  });

  it("is the message of each caller's own", () => {
    expect(optionalEmail("Invalid email format").safeParse("nope").error?.issues[0].message).toBe(
      "Invalid email format",
    );
  });
});
