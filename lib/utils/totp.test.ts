// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CLOCK_TOLERANCE_SECONDS, totpGenerate, totpGenerateSecret, totpVerify } from "./totp";

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

  /**
   * The server and the phone never agree to the second, so the code of the step before or after
   * is accepted too. It used to be refused: only the current step passed (otplib's default), and
   * an owner whose clock was a few seconds out was told the right code was incorrect and locked
   * out of the sign-in. Each case asks for the code of another moment, not for the real one.
   */
  describe("clock drift", () => {
    const NOW = 1_800_000_000;
    const STEP = 30;

    it("accepts the code of the step before and the step after", () => {
      expect(totpVerify(totpGenerate(secret, NOW - STEP), secret, NOW)).toBe(true);
      expect(totpVerify(totpGenerate(secret, NOW + STEP), secret, NOW)).toBe(true);
    });

    it("refuses a code two steps away, in either direction", () => {
      expect(totpVerify(totpGenerate(secret, NOW - 2 * STEP), secret, NOW)).toBe(false);
      expect(totpVerify(totpGenerate(secret, NOW + 2 * STEP), secret, NOW)).toBe(false);
    });

    it("tolerates exactly one step", () => {
      expect(CLOCK_TOLERANCE_SECONDS).toBe(STEP);
    });

    it("still refuses a code made for another secret, however close its moment", () => {
      const other = totpGenerateSecret();
      expect(totpVerify(totpGenerate(other, NOW), secret, NOW)).toBe(false);
    });
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
