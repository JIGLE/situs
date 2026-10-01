// @vitest-environment node
import { describe, expect, it } from "vitest";
import { totpGenerate, totpGenerateSecret, totpVerify } from "./totp";

/**
 * The code is typed by a person, so what reaches `totpVerify` is whatever fits in the box. otplib
 * throws on a token that is not six digits: the two routes that verify one answered a 500 for
 * "abcdef", a caller's mistake, instead of "invalid code".
 */

const secret = totpGenerateSecret();

describe("totpVerify", () => {
  it("accepts the code the authenticator shows now", () => {
    expect(totpVerify(totpGenerate(secret), secret)).toBe(true);
  });

  it("refuses a wrong code of six digits", () => {
    const right = totpGenerate(secret);
    const wrong = right === "000000" ? "000001" : "000000";

    expect(totpVerify(wrong, secret)).toBe(false);
  });

  it.each([
    ["six letters", "abcdef"],
    ["letters among the digits", "12a456"],
    ["five digits", "12345"],
    ["seven digits", "1234567"],
    ["a space inside", "123 456"],
    ["a backup code", "ABCD1234"],
    ["nothing", ""],
  ])("answers false, and does not throw, for %s", (_label, token) => {
    expect(() => totpVerify(token, secret)).not.toThrow();
    expect(totpVerify(token, secret)).toBe(false);
  });
});
