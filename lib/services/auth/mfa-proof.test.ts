// @vitest-environment node
import { describe, it, expect } from "vitest";
import { VALID_FOR_MS, signMfaProof, verifyMfaProof } from "./mfa-proof";

/**
 * A proof is what lets one session out of the second factor: made when a code is accepted, valid
 * for that session alone. These are the ways it must refuse, since the check exists for the
 * session that did not enter the code.
 */

const SECRET = "mfa-proof-test-secret-0123456789-abcdefghij";
const NOW = 1_800_000_000_000;
const SESSION = { userId: "user-1", sid: "sid-aaaaaaaa" };

const fresh = () => signMfaProof(SECRET, SESSION, NOW);

describe("a proof of the second factor", () => {
  it("is accepted for the session it was made for, while it lives", () => {
    expect(verifyMfaProof(SECRET, fresh(), SESSION, NOW)).toBe(true);
    expect(verifyMfaProof(SECRET, fresh(), SESSION, NOW + VALID_FOR_MS - 1)).toBe(true);
  });

  it("is refused for another session of the same account", () => {
    // The case that mattered: the owner verifies, and a password-only sign-in a moment later
    // carries a session of its own.
    expect(verifyMfaProof(SECRET, fresh(), { ...SESSION, sid: "sid-bbbbbbbb" }, NOW)).toBe(false);
  });

  it("is refused for another account's session", () => {
    expect(verifyMfaProof(SECRET, fresh(), { ...SESSION, userId: "user-2" }, NOW)).toBe(false);
  });

  it("is refused once it has expired", () => {
    expect(verifyMfaProof(SECRET, fresh(), SESSION, NOW + VALID_FOR_MS)).toBe(false);
    expect(verifyMfaProof(SECRET, fresh(), SESSION, NOW + VALID_FOR_MS + 1)).toBe(false);
  });

  it("is refused when it was made to live longer than a proof does", () => {
    const overlong = signMfaProof(SECRET, SESSION, NOW + 10 * VALID_FOR_MS);
    expect(verifyMfaProof(SECRET, overlong, SESSION, NOW)).toBe(false);
  });

  it("is refused under another secret, and with none", () => {
    expect(verifyMfaProof("another-secret-0123456789-abcdefghijklmn", fresh(), SESSION, NOW)).toBe(
      false,
    );
    expect(verifyMfaProof(undefined, fresh(), SESSION, NOW)).toBe(false);
    expect(verifyMfaProof("", fresh(), SESSION, NOW)).toBe(false);
  });

  it("cannot be signed without a secret", () => {
    expect(() => signMfaProof("", SESSION, NOW)).toThrow();
  });

  it("is refused when its expiry or its MAC was changed", () => {
    const [version, expires, mac] = fresh().split(".");

    // A later expiry under the same MAC.
    expect(verifyMfaProof(SECRET, `${version}.${Number(expires) + 1}.${mac}`, SESSION, NOW)).toBe(
      false,
    );
    // One character of the MAC.
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    expect(verifyMfaProof(SECRET, `${version}.${expires}.${flipped}`, SESSION, NOW)).toBe(false);
    // A MAC that is a prefix of the right one.
    expect(verifyMfaProof(SECRET, `${version}.${expires}.${mac.slice(0, 10)}`, SESSION, NOW)).toBe(
      false,
    );
  });

  it("is refused when the same expiry is written another way", () => {
    const [version, expires, mac] = fresh().split(".");
    const spelled = Number(expires).toExponential();

    expect(Number(spelled)).toBe(Number(expires));
    expect(verifyMfaProof(SECRET, `${version}.${spelled}.${mac}`, SESSION, NOW)).toBe(false);
    expect(verifyMfaProof(SECRET, `${version}.0${expires}.${mac}`, SESSION, NOW)).toBe(false);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a number", 123],
    ["an object", { mfaProof: "x" }],
    ["an empty string", ""],
    ["one part", "v1"],
    ["two parts", "v1.1800000060000"],
    ["an empty MAC", "v1.1800000060000."],
    ["another version", fresh().replace(/^v1/, "v2")],
    ["four parts", `${fresh()}.extra`],
    ["a word for the expiry", "v1.soon.AAAA"],
  ])("is refused when it is %s", (_label, proof) => {
    expect(verifyMfaProof(SECRET, proof, SESSION, NOW)).toBe(false);
  });

  it("does not mistake one user and session for another by how they are joined", () => {
    // A joined string would read "a" + "b.c" the same as "a.b" + "c".
    const proof = signMfaProof(SECRET, { userId: "a", sid: "b.c" }, NOW);

    expect(verifyMfaProof(SECRET, proof, { userId: "a.b", sid: "c" }, NOW)).toBe(false);
    expect(verifyMfaProof(SECRET, proof, { userId: "a", sid: "b.c" }, NOW)).toBe(true);
  });
});
