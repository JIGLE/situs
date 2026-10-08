// @vitest-environment node
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEYED_IBAN_HASH_PREFIX,
  hashIban,
  ibanHashKeyConfigured,
  isKeyedIbanHash,
  keyedIbanHash,
  plainIbanHash,
} from "./iban-hash";

/**
 * The stored form of an IBAN is a keyed hash, so a copy of the database file cannot be used to hash
 * every candidate IBAN and read the numbers back. What is proved here: the value really depends on
 * the key, it is built the way the migration assumes, and without a key nothing changes.
 */

const IBAN = "PT50 0002 0123 1234 5678 9015 4";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

/** The documented construction, written out independently of the module. */
function expectedKeyed(plain: string, keyHex: string): string {
  const key = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyHex, "hex"), "", "situs/iban-hash/v2", 32),
  );
  return "v2:" + crypto.createHmac("sha256", key).update(plain).digest("hex");
}

beforeEach(() => vi.stubEnv("PII_ENCRYPTION_KEY", KEY_A));
afterEach(() => vi.unstubAllEnvs());

describe("hashIban with a key", () => {
  it("is the documented HMAC of the plain SHA-256, under a key derived from the PII key", () => {
    const plain = crypto.createHash("sha256").update("PT50000201231234567890154").digest("hex");

    expect(plainIbanHash(IBAN)).toBe(plain);
    expect(hashIban(IBAN)).toBe(expectedKeyed(plain, KEY_A));
  });

  it("is marked, and is not the plain hash a copy of the file could be tested against", () => {
    const stored = hashIban(IBAN);

    expect(stored.startsWith(KEYED_IBAN_HASH_PREFIX)).toBe(true);
    expect(isKeyedIbanHash(stored)).toBe(true);
    expect(stored).not.toContain(plainIbanHash(IBAN));
  });

  it("is the same for the same IBAN however it is written, and different for another", () => {
    expect(hashIban("pt50000201231234567890154")).toBe(hashIban(IBAN));
    expect(hashIban("PT50 0002 0123 1234 5678 9015 5")).not.toBe(hashIban(IBAN));
  });

  it("depends on the key: another PII key gives another value", () => {
    const a = hashIban(IBAN);
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY_B);

    expect(hashIban(IBAN)).not.toBe(a);
    expect(hashIban(IBAN)).toBe(expectedKeyed(plainIbanHash(IBAN), KEY_B));
  });

  it("is not the HMAC under the PII key itself: the key it uses is derived for this purpose", () => {
    const direct = crypto
      .createHmac("sha256", Buffer.from(KEY_A, "hex"))
      .update(plainIbanHash(IBAN))
      .digest("hex");

    expect(hashIban(IBAN)).not.toBe(`v2:${direct}`);
  });
});

describe("keyedIbanHash, which converts what is already stored", () => {
  it("turns a stored plain hash into what hashIban would have stored, without the IBAN", () => {
    expect(keyedIbanHash(plainIbanHash(IBAN))).toBe(hashIban(IBAN));
  });

  it("leaves a value that is keyed already as it is, so converting twice is converting once", () => {
    const stored = hashIban(IBAN);

    expect(keyedIbanHash(stored)).toBe(stored);
  });
});

describe("without a key", () => {
  beforeEach(() => vi.stubEnv("PII_ENCRYPTION_KEY", ""));

  it("stays the plain hash, as before, and says no key is configured", () => {
    expect(ibanHashKeyConfigured()).toBe(false);
    expect(hashIban(IBAN)).toBe(plainIbanHash(IBAN));
    expect(isKeyedIbanHash(hashIban(IBAN))).toBe(false);
  });

  it("does not take a value that is not hex, which Buffer.from would quietly cut short", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", "z".repeat(64));

    expect(ibanHashKeyConfigured()).toBe(false);
    expect(hashIban(IBAN)).toBe(plainIbanHash(IBAN));
  });

  it("does not take a key that is too short for one", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", "abc");

    expect(ibanHashKeyConfigured()).toBe(false);
    expect(keyedIbanHash("0".repeat(64))).toBe("0".repeat(64));
  });
});
