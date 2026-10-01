import { describe, expect, it } from "vitest";
import { joinContact } from "./contact";

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
