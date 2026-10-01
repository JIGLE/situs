import { describe, expect, it } from "vitest";
import { blankToNull } from "./tax-identity";

/**
 * Also what stores a tenant's or an owner's email and phone: the service uses it, with `?? null` on
 * a create. A blank input is NULL, never "", which a unique index would count as a value; undefined
 * stays undefined, so an update that does not mention a field leaves it as it is.
 */
describe("blankToNull", () => {
  it.each([
    ["an empty string", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
  ])("is null for %s", (_label, value) => {
    expect(blankToNull(value)).toBeNull();
  });

  it("leaves null and undefined as they are, so an update can tell clearing from not sending", () => {
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeUndefined();
  });

  it("keeps what is there, without the spaces round it", () => {
    expect(blankToNull("ana@example.com")).toBe("ana@example.com");
    expect(blankToNull("  ana@example.com ")).toBe("ana@example.com");
    expect(blankToNull("912 345 678")).toBe("912 345 678");
  });
});
