import { describe, expect, it } from "vitest";
import { blankToNull, joinContact } from "./contact";

/**
 * Email and phone are optional now: a landlord or tenant read from Finanças has a NIF and a name and
 * nothing else. What is not there is NULL, never "", which a unique index would count as a value.
 */
describe("blankToNull", () => {
  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
  ])("is null for %s", (_label, value) => {
    expect(blankToNull(value)).toBeNull();
  });

  it("keeps what is there, without the spaces round it", () => {
    expect(blankToNull("ana@example.com")).toBe("ana@example.com");
    expect(blankToNull("  ana@example.com ")).toBe("ana@example.com");
    expect(blankToNull("912 345 678")).toBe("912 345 678");
  });
});

describe("joinContact", () => {
  it("joins the fields that are there", () => {
    expect(joinContact("ana@example.com", "912345678")).toBe("ana@example.com · 912345678");
  });

  it("leaves out the ones that are not, so no separator is left hanging", () => {
    expect(joinContact(null, "912345678")).toBe("912345678");
    expect(joinContact("ana@example.com", "")).toBe("ana@example.com");
    expect(joinContact(undefined, "  ")).toBe("");
    expect(joinContact()).toBe("");
  });
});
