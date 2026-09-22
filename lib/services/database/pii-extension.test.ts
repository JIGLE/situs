import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encryptArgs, decryptResult } from "./pii-extension";
import { PII_FIELDS, isEncrypted } from "@/lib/utils/pii-encryption";

// A valid 32-byte (64 hex char) key so encryptPII actually encrypts rather
// than passing plaintext through (its dev-mode no-key behavior).
const TEST_KEY = "a".repeat(64);

describe("piiEncryptionExtension — transform logic", () => {
  const originalKey = process.env.PII_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.PII_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = originalKey;
  });

  it("encrypts PII_FIELDS in create() args.data before the write", () => {
    const args = {
      data: { name: "Maria Silva", phone: "+351 912 345 678", email: "maria@example.com" },
    };
    const encrypted = encryptArgs(args, PII_FIELDS.Tenant) as typeof args;

    // What actually gets stored: ciphertext, not the plaintext phone number.
    expect(isEncrypted(encrypted.data.phone)).toBe(true);
    expect(encrypted.data.phone).not.toBe(args.data.phone);
    // Fields outside PII_FIELDS are untouched.
    expect(encrypted.data.name).toBe("Maria Silva");
    expect(encrypted.data.email).toBe("maria@example.com");
    // The original args object passed by the caller is not mutated in place.
    expect(args.data.phone).toBe("+351 912 345 678");
  });

  it("encrypts createMany() args.data arrays", () => {
    const args = {
      data: [
        { name: "Tenant A", phone: "111111111" },
        { name: "Tenant B", phone: "222222222" },
      ],
    };
    const encrypted = encryptArgs(args, PII_FIELDS.Tenant) as typeof args;

    expect(isEncrypted(encrypted.data[0].phone)).toBe(true);
    expect(isEncrypted(encrypted.data[1].phone)).toBe(true);
  });

  it("encrypts upsert() create and update blocks", () => {
    const args = {
      where: { id: "owner-1" },
      create: { name: "Carlos", taxIdentificationNumber: "123456789", phone: "912000000" },
      update: { taxIdentificationNumber: "987654321" },
    };
    const encrypted = encryptArgs(args, PII_FIELDS.Owner) as typeof args;

    expect(isEncrypted(encrypted.create.taxIdentificationNumber)).toBe(true);
    expect(isEncrypted(encrypted.create.phone)).toBe(true);
    expect(isEncrypted(encrypted.update.taxIdentificationNumber)).toBe(true);
  });

  it("round-trips: decryptResult recovers the original plaintext", () => {
    // Was PaymentMethod's iban/accountHolder until the payment stack was cut. RentReceipt's
    // NIFs exercise the same path — several declared fields on one model, encrypted on write
    // and recovered on read.
    const original = { landlordNif: "111222333", tenantNif: "444555666" };
    const encrypted = encryptArgs({ data: original }, PII_FIELDS.RentReceipt) as {
      data: typeof original;
    };

    const decrypted = decryptResult(encrypted.data, PII_FIELDS.RentReceipt) as typeof original;

    expect(decrypted.landlordNif).toBe(original.landlordNif);
    expect(decrypted.tenantNif).toBe(original.tenantNif);
  });

  it("decrypts arrays of rows (findMany-shaped results)", () => {
    const rows = [
      { id: "1", landlordNif: "111222333", tenantNif: "444555666" },
      { id: "2", landlordNif: "777888999", tenantNif: "000111222" },
    ];
    const encrypted = rows.map(
      (r) => encryptArgs({ data: r }, PII_FIELDS.RentReceipt).data as (typeof rows)[number],
    );

    const decrypted = decryptResult(encrypted, PII_FIELDS.RentReceipt) as typeof rows;

    expect(decrypted[0].landlordNif).toBe("111222333");
    expect(decrypted[1].tenantNif).toBe("000111222");
  });

  it("passes through non-object / missing-field results untouched", () => {
    expect(decryptResult(null, PII_FIELDS.Tenant)).toBeNull();
    expect(decryptResult(5, PII_FIELDS.Tenant)).toBe(5);
    expect(decryptResult({ id: "1" }, PII_FIELDS.Tenant)).toEqual({ id: "1" });
  });
});
