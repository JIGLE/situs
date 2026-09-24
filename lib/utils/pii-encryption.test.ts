import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  decryptFile,
  decryptPII,
  encryptFile,
  encryptPII,
  isEncrypted,
  isEncryptedFile,
} from "./pii-encryption";

/**
 * `decryptPII` has three failure modes and they were not handled consistently.
 *
 * A missing key and a malformed value both returned "[ENCRYPTED]" and let the record load. A key
 * that was present but WRONG fell through to `decipher.final()`, where AES-GCM's authentication
 * tag check throws — and that exception escaped into `pii-extension.ts`, which wraps
 * `$allModels`, so one undecryptable row turned an entire `findMany` into a 500.
 *
 * That third case is the only one an operator causes by hand: rotating PII_ENCRYPTION_KEY on an
 * instance that already holds data. The symptom is every page failing with "Internal server
 * error" and the cause named nowhere, because the route layer deliberately does not echo
 * exception text.
 *
 * These pin all three as degrading the same way — and, just as importantly, pin that a CORRECT
 * key still round-trips, so "return [ENCRYPTED] always" cannot pass.
 */

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.PII_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
  delete process.env.PII_ENCRYPTION_KEY;
});

describe("round trip", () => {
  it("encrypts and decrypts back to the original", () => {
    const plaintext = "PT50000201231234567890154";
    const ciphertext = encryptPII(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(decryptPII(ciphertext)).toBe(plaintext);
  });

  it("passes plaintext through untouched", () => {
    // Rows written before the key existed are not prefixed and must keep working.
    expect(decryptPII("+351 912 345 678")).toBe("+351 912 345 678");
  });
});

describe("a wrong key degrades instead of throwing", () => {
  it("returns the masked placeholder rather than propagating an exception", () => {
    const ciphertext = encryptPII("PT50000201231234567890154");

    // The rotation an operator actually performs.
    process.env.PII_ENCRYPTION_KEY = KEY_B;

    // Before the guard this threw, and the throw reached the Prisma extension.
    expect(() => decryptPII(ciphertext)).not.toThrow();
    expect(decryptPII(ciphertext)).toBe("[ENCRYPTED]");
  });

  it("logs the likely cause, since the HTTP response deliberately will not", () => {
    const ciphertext = encryptPII("123456789");
    process.env.PII_ENCRYPTION_KEY = KEY_B;

    decryptPII(ciphertext);

    expect(error).toHaveBeenCalled();
    const message = String(error.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/PII_ENCRYPTION_KEY/);
  });

  it("does not put ciphertext or key material in the log", () => {
    const ciphertext = encryptPII("PT50000201231234567890154");
    process.env.PII_ENCRYPTION_KEY = KEY_B;

    decryptPII(ciphertext);

    // This logs once per failing row, so it must not become a channel for the data it protects.
    const message = String(error.mock.calls[0]?.[0] ?? "");
    expect(message).not.toContain(ciphertext);
    expect(message).not.toContain(KEY_A);
    expect(message).not.toContain(KEY_B);
  });
});

describe("the other two failure modes still degrade the same way", () => {
  it("returns the placeholder when the key is absent", () => {
    const ciphertext = encryptPII("123456789");
    delete process.env.PII_ENCRYPTION_KEY;

    expect(decryptPII(ciphertext)).toBe("[ENCRYPTED]");
  });

  it("returns the placeholder for a malformed value", () => {
    expect(decryptPII("enc:only-one-part")).toBe("[ENCRYPTED]");
  });

  it("returns the placeholder for a corrupted ciphertext body", () => {
    // Right shape, wrong contents — the auth tag catches it at final().
    const ciphertext = encryptPII("123456789");
    const [prefixed, tag] = ciphertext.split(":").slice(0, 2);
    const corrupted = `${prefixed}:${tag}:${Buffer.from("nonsense").toString("base64")}`;

    expect(() => decryptPII(corrupted)).not.toThrow();
    expect(decryptPII(corrupted)).toBe("[ENCRYPTED]");
  });
});

/**
 * A stored contract PDF carries the same NIFs `PII_FIELDS` encrypts in their own columns, so it is
 * encrypted too: at the call site, since it is bytes and the Prisma extension transforms strings.
 */
describe("files", () => {
  const pdf = Buffer.from("%PDF-1.7\nContrato de arrendamento, NIF 123456789\n%%EOF");

  it("round-trips, and what is stored does not contain the text", () => {
    const stored = encryptFile(pdf);

    expect(isEncryptedFile(stored)).toBe(true);
    expect(stored.includes(Buffer.from("123456789"))).toBe(false);
    expect(decryptFile(stored)?.equals(pdf)).toBe(true);
  });

  it("serves a file stored before encryption as it is", () => {
    expect(isEncryptedFile(pdf)).toBe(false);
    expect(decryptFile(pdf)?.equals(pdf)).toBe(true);
  });

  it("stores the file as it is when no key is configured", () => {
    delete process.env.PII_ENCRYPTION_KEY;

    expect(encryptFile(pdf).equals(pdf)).toBe(true);
  });

  it("returns null, without throwing, when the key has changed", () => {
    const stored = encryptFile(pdf);
    process.env.PII_ENCRYPTION_KEY = KEY_B;

    expect(decryptFile(stored)).toBeNull();
    expect(String(error.mock.calls[0]?.[0] ?? "")).toMatch(/PII_ENCRYPTION_KEY/);
  });

  it("returns null when the key is absent", () => {
    const stored = encryptFile(pdf);
    delete process.env.PII_ENCRYPTION_KEY;

    expect(decryptFile(stored)).toBeNull();
  });

  it("returns null for a truncated or tampered file", () => {
    const stored = encryptFile(pdf);
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1] ^= 0xff;

    expect(decryptFile(stored.subarray(0, 20))).toBeNull();
    expect(decryptFile(tampered)).toBeNull();
  });
});
