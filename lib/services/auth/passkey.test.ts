import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CHALLENGE_VALID_FOR_MS,
  cleanName,
  openChallenge,
  relyingParty,
  signChallenge,
  summarize,
} from "./passkey";

const SECRET = "a-secret-of-at-least-thirty-two-characters";
const NOW = 1_700_000_000_000;
const newChallenge = () => randomBytes(32).toString("base64url");
const SIGN_IN = { kind: "authenticate", userId: "user-1", sid: "session-1" } as const;

describe("a passkey challenge", () => {
  it("opens for the scope it was made for, and returns the challenge", () => {
    const challenge = newChallenge();
    const token = signChallenge(SECRET, SIGN_IN, challenge, NOW);

    expect(openChallenge(SECRET, token, SIGN_IN, NOW + 1_000)).toBe(challenge);
  });

  it.each([
    ["another account", { ...SIGN_IN, userId: "user-2" }],
    ["another session", { ...SIGN_IN, sid: "session-2" }],
    ["a registration", { kind: "register", userId: "user-1" } as const],
  ])("opens for nothing else: %s", (_name, scope) => {
    const token = signChallenge(SECRET, SIGN_IN, newChallenge(), NOW);

    expect(openChallenge(SECRET, token, scope, NOW)).toBeNull();
  });

  it("does not let a registration challenge answer a sign-in", () => {
    const token = signChallenge(
      SECRET,
      { kind: "register", userId: "user-1" },
      newChallenge(),
      NOW,
    );

    expect(openChallenge(SECRET, token, SIGN_IN, NOW)).toBeNull();
  });

  it("expires after two minutes", () => {
    const token = signChallenge(SECRET, SIGN_IN, newChallenge(), NOW);

    expect(openChallenge(SECRET, token, SIGN_IN, NOW + CHALLENGE_VALID_FOR_MS - 1)).not.toBeNull();
    expect(openChallenge(SECRET, token, SIGN_IN, NOW + CHALLENGE_VALID_FOR_MS)).toBeNull();
  });

  it("refuses a token signed under another secret, a changed challenge or a longer life", () => {
    const challenge = newChallenge();
    const token = signChallenge(SECRET, SIGN_IN, challenge, NOW);
    const [version, expires, , mac] = token.split(".");

    expect(
      openChallenge("another-secret-of-thirty-two-characters!", token, SIGN_IN, NOW),
    ).toBeNull();
    expect(
      openChallenge(SECRET, [version, expires, newChallenge(), mac].join("."), SIGN_IN, NOW),
    ).toBeNull();
    // The same MAC under a lifetime it was not made for.
    const longer = String(Number(expires) + 60 * 60_000);
    expect(
      openChallenge(SECRET, [version, longer, challenge, mac].join("."), SIGN_IN, NOW),
    ).toBeNull();
  });

  it.each([undefined, null, 42, "", "v1.x.y.z", "v2.1.2.3", "a.b.c"])(
    "refuses a token that is not one: %s",
    (token) => {
      expect(openChallenge(SECRET, token, SIGN_IN, NOW)).toBeNull();
    },
  );

  it("is not signed or opened without the server's secret", () => {
    expect(() => signChallenge("", SIGN_IN, newChallenge(), NOW)).toThrow();
    const token = signChallenge(SECRET, SIGN_IN, newChallenge(), NOW);
    expect(openChallenge(undefined, token, SIGN_IN, NOW)).toBeNull();
    expect(openChallenge("", token, SIGN_IN, NOW)).toBeNull();
  });
});

describe("the site a passkey belongs to", () => {
  it("is the instance's public address, not the host of a request", () => {
    const before = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://situs.example.pt/app?x=1";
    try {
      expect(relyingParty()).toEqual({
        rpID: "situs.example.pt",
        origin: "https://situs.example.pt",
      });
    } finally {
      if (before === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = before;
    }
  });

  it("keeps the port in the origin and out of the id", () => {
    const before = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    try {
      expect(relyingParty()).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
    } finally {
      if (before === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = before;
    }
  });
});

describe("what the owner sees of a passkey", () => {
  const row = {
    id: "p1",
    name: "Pixel 9",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    lastUsedAt: null,
    deviceType: "multiDevice",
  };

  it("is a name, two dates and whether it syncs: never the key or the credential id", () => {
    const summary = summarize({
      ...row,
      credentialId: "secret-id",
      publicKey: "key",
    } as typeof row);

    expect(summary).toEqual({
      id: "p1",
      name: "Pixel 9",
      createdAt: "2026-10-01T10:00:00.000Z",
      lastUsedAt: null,
      synced: true,
    });
    expect(JSON.stringify(summary)).not.toMatch(/secret-id|key/);
  });

  it("calls a single-device passkey not synced", () => {
    expect(summarize({ ...row, deviceType: "singleDevice" }).synced).toBe(false);
  });

  it("names a passkey by what was typed, trimmed and bounded, or by the fallback", () => {
    expect(cleanName("  My   phone ", "Passkey")).toBe("My phone");
    expect(cleanName("x".repeat(200), "Passkey")).toHaveLength(60);
    expect(cleanName("   ", "Passkey")).toBe("Passkey");
    expect(cleanName(undefined, "Passkey")).toBe("Passkey");
    expect(cleanName(42, "Passkey")).toBe("Passkey");
  });
});
