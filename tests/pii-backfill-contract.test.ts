// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { PII_FIELDS, decryptFile, encryptFile, isEncryptedFile } from "@/lib/utils/pii-encryption";

/**
 * scripts/backfill-pii-encryption.js re-encrypts rows written before the Prisma extension existed.
 * It is plain CommonJS with no path aliases, so it carries its own copy of PII_FIELDS — and that
 * copy drifted: it kept `paymentMethod` after the model was deleted, so the script threw on its
 * first iteration and encrypted nothing. Reading the table as text keeps the script un-run here.
 */
function scriptTable(): Record<string, string[]> {
  const src = readFileSync(path.join(process.cwd(), "scripts/backfill-pii-encryption.js"), "utf8");
  const block = src.match(/const PII_FIELDS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("PII_FIELDS table not found in scripts/backfill-pii-encryption.js");
  return Object.fromEntries(
    [...block[1].matchAll(/^\s*(\w+): \[([^\]]*)\]/gm)].map(([, model, fields]) => [
      model,
      [...fields.matchAll(/"(\w+)"/g)].map((m) => m[1]),
    ]),
  );
}

describe("PII backfill contract", () => {
  it("encrypts exactly the fields the Prisma extension encrypts", () => {
    // A Prisma delegate is the model name with its first letter lowercased: `RentReceipt` is
    // `prisma.rentReceipt`.
    const expected = Object.fromEntries(
      Object.entries(PII_FIELDS).map(([model, fields]) => [
        model[0].toLowerCase() + model.slice(1),
        fields,
      ]),
    );
    const actual = scriptTable();
    expect(Object.keys(actual).length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
  });

  describe("lease contracts", () => {
    const KEY = "a".repeat(64);
    afterEach(() => vi.unstubAllEnvs());

    // Required rather than run: the script starts its backfill only from the command line.
    const script = createRequire(import.meta.url)("../scripts/backfill-pii-encryption.js") as {
      encryptFile: (plain: Uint8Array, key: Buffer) => Buffer;
      isEncryptedFile: (bytes: Uint8Array) => boolean;
    };

    it("writes a contract the app's decryptFile reads back", () => {
      vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
      const pdf = Buffer.from("%PDF-1.4 a signed contract");

      const stored = script.encryptFile(pdf, Buffer.from(KEY, "hex"));

      expect(isEncryptedFile(stored)).toBe(true);
      expect(decryptFile(stored)?.equals(pdf)).toBe(true);
    });

    // Encrypted twice, a contract decrypts to the inner envelope rather than to the PDF.
    it("skips a contract the app already encrypted, and nothing else", () => {
      vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
      const pdf = Buffer.from("%PDF-1.4 a signed contract");

      expect(script.isEncryptedFile(encryptFile(pdf))).toBe(true);
      expect(script.isEncryptedFile(pdf)).toBe(false);
    });
  });
});
