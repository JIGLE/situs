import { describe, expect, it } from "vitest";
import {
  signKeepProof,
  verifyKeepProof,
  VALID_FOR_MS,
} from "@/lib/services/auth/session-keep-proof";

const SECRET = "keep-proof-secret-0123456789-abcdefghijklmnop";
const SESSION = { userId: "user-1", signedAt: 1_700_000_000_000 };
const NOW = 1_800_000_000_000;

describe("session keep proof", () => {
  it("is accepted for the session it was made for", () => {
    const proof = signKeepProof(SECRET, SESSION, NOW);
    expect(verifyKeepProof(SECRET, proof, SESSION, NOW + 1_000)).toBe(true);
  });

  it("is refused for another account, another session of the account, or another secret", () => {
    const proof = signKeepProof(SECRET, SESSION, NOW);
    expect(verifyKeepProof(SECRET, proof, { ...SESSION, userId: "user-2" }, NOW)).toBe(false);
    // A session signed in at another moment is another session: this is what stops an older
    // cookie from stepping over the stamp with a proof that was made for the owner's own.
    expect(
      verifyKeepProof(SECRET, proof, { ...SESSION, signedAt: SESSION.signedAt + 1 }, NOW),
    ).toBe(false);
    expect(verifyKeepProof(`${SECRET}x`, proof, SESSION, NOW)).toBe(false);
  });

  it("is refused once it has expired, and not before", () => {
    const proof = signKeepProof(SECRET, SESSION, NOW);
    expect(verifyKeepProof(SECRET, proof, SESSION, NOW + VALID_FOR_MS - 1)).toBe(true);
    expect(verifyKeepProof(SECRET, proof, SESSION, NOW + VALID_FOR_MS)).toBe(false);
  });

  it("is refused when it claims a longer life than a proof has", () => {
    const [version, , mac] = signKeepProof(SECRET, SESSION, NOW).split(".");
    const stretched = `${version}.${NOW + VALID_FOR_MS * 60}.${mac}`;
    expect(verifyKeepProof(SECRET, stretched, SESSION, NOW)).toBe(false);
  });

  it("is not a proof of a code: the second factor's proof does not pass as one", async () => {
    const { signMfaProof } = await import("@/lib/services/auth/mfa-proof");
    const mfa = signMfaProof(SECRET, { userId: "user-1", sid: "1700000000000" }, NOW);
    expect(verifyKeepProof(SECRET, mfa, SESSION, NOW)).toBe(false);
  });

  it.each([undefined, null, 42, "", "v1", "v1.1.2.3", "v2.1.abc"])(
    "refuses %j, and refuses everything without a secret",
    (junk) => {
      expect(verifyKeepProof(SECRET, junk, SESSION, NOW)).toBe(false);
      const proof = signKeepProof(SECRET, SESSION, NOW);
      expect(verifyKeepProof(undefined, proof, SESSION, NOW)).toBe(false);
    },
  );

  it("will not sign without the server's secret", () => {
    expect(() => signKeepProof("", SESSION, NOW)).toThrow();
  });
});
