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

  // AT gives non-resident individuals NIFs starting with 45, so a landlord or tenant who lives
  // abroad may hold one.
  it("accepts a non-resident's NIF, which starts with 45", () => {
    expect(validatePortugueseNIF("450000001")).toBe(true);
    expect(validatePortugueseNIF("451 234 561")).toBe(true);
  });

  it("still checks a non-resident NIF's check digit", () => {
    expect(validatePortugueseNIF("450000002")).toBe(false);
  });

  // Each of these has a valid check digit, so only its prefix can be the reason it is refused.
  it("refuses a prefix AT does not assign, even with a valid check digit", () => {
    expect(validatePortugueseNIF("400000008")).toBe(false);
    expect(validatePortugueseNIF("440000009")).toBe(false);
    expect(validatePortugueseNIF("460000004")).toBe(false);
    expect(validatePortugueseNIF("499999991")).toBe(false);
    expect(validatePortugueseNIF("012345679")).toBe(false);
  });
});
