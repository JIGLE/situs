import { describe, expect, it } from "vitest";

import { validatePortugueseNIF } from "./tax-id-validation";

describe("validatePortugueseNIF", () => {
  it("accepts a NIF whose check digit matches, however it is spaced", () => {
    expect(validatePortugueseNIF("123456789")).toBe(true);
    expect(validatePortugueseNIF("123 456 789")).toBe(true);
  });

  it("refuses a NIF whose check digit does not match", () => {
    expect(validatePortugueseNIF("123456780")).toBe(false);
  });

  it("refuses anything but nine digits", () => {
    expect(validatePortugueseNIF("12345678")).toBe(false);
    expect(validatePortugueseNIF("1234567890")).toBe(false);
    expect(validatePortugueseNIF("")).toBe(false);
  });
});
