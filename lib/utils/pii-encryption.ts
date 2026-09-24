/**
 * PII Field Encryption — AES-256-GCM
 *
 * Encrypts sensitive fields (IBAN, NIF, phone) at rest.
 * Uses a 32-byte hex key from PII_ENCRYPTION_KEY env var.
 *
 * Usage: wrap field values with encrypt()/decrypt() in service layer,
 * or use the Prisma extension for automatic field-level encryption.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const ENCODING = "base64" as const;

// Prefix for encrypted values to distinguish from plaintext
const ENCRYPTED_PREFIX = "enc:";

function getEncryptionKey(): Buffer | null {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) return null;
  return Buffer.from(hex, "hex");
}

/**
 * Warn once per process when PII is being written unencrypted. The server refuses to boot
 * production without a key (`instrumentation.ts` runs `lib/utils/env.ts` at startup), but scripts
 * and one-off tooling do not go through it — and a silent fallback to plaintext is exactly the
 * failure that should never be quiet.
 */
let warnedAboutMissingKey = false;

function warnOnceAboutPlaintext(): void {
  if (warnedAboutMissingKey) return;
  warnedAboutMissingKey = true;
  if (process.env.NODE_ENV === "test") return;
  console.warn(
    "⚠️  [PII] PII_ENCRYPTION_KEY is not configured — IBAN, NIF and phone values are being " +
      "stored in PLAINTEXT. Generate a key with: openssl rand -hex 32",
  );
}

/**
 * Encrypt a plaintext string. Returns prefixed base64 string.
 * If no key is configured, returns plaintext unchanged (dev mode) after warning once.
 */
export function encryptPII(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getEncryptionKey();
  if (!key) {
    warnOnceAboutPlaintext();
    return plaintext; // No key = no encryption (dev mode)
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: enc:<iv>:<tag>:<ciphertext> (all base64)
  return `${ENCRYPTED_PREFIX}${iv.toString(ENCODING)}:${tag.toString(ENCODING)}:${encrypted.toString(ENCODING)}`;
}

/**
 * Decrypt an encrypted PII string. If not prefixed, assumes plaintext.
 */
export function decryptPII(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext;

  const key = getEncryptionKey();
  if (!key) {
    console.warn("[PII] Encrypted data found but PII_ENCRYPTION_KEY not set — cannot decrypt");
    return "[ENCRYPTED]";
  }

  const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) {
    console.warn("[PII] Malformed encrypted value");
    return "[ENCRYPTED]";
  }

  // The three ways this can fail are NOT equivalent, and only two were handled.
  //
  // A missing key and a malformed value both return "[ENCRYPTED]" above. The third — a key that
  // is present but WRONG — reaches `decipher.final()`, where AES-GCM's authentication tag check
  // throws. That exception escapes into `pii-extension.ts`, which wraps `$allModels`, so a single
  // undecryptable row turns an entire `findMany` into a 500.
  //
  // It is also the only one of the three an operator causes by hand: rotating PII_ENCRYPTION_KEY
  // on an instance that already has data. The rows encrypted under the old key become poison, and
  // the symptom is every page failing with "Internal server error" — with the cause named
  // nowhere, because the route layer deliberately does not echo exception text.
  //
  // So it degrades like its neighbours: the record still loads, the protected field reads
  // "[ENCRYPTED]", and the reason goes to the log. A landlord seeing a masked phone number can
  // still work; a landlord seeing a blank dashboard cannot.
  try {
    const iv = Buffer.from(parts[0], ENCODING);
    const tag = Buffer.from(parts[1], ENCODING);
    const encrypted = Buffer.from(parts[2], ENCODING);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    // No ciphertext or key material in the message — this runs on every row of a failing table.
    console.error(
      "[PII] Decryption failed for a stored value. The most likely cause is that " +
        "PII_ENCRYPTION_KEY has changed since the row was written. Run " +
        "scripts/backfill-pii-encryption.js after a deliberate key rotation.",
    );
    return "[ENCRYPTED]";
  }
}

/**
 * Check if a value is encrypted
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false;
}

/**
 * Mask a decrypted PII value for display (e.g. IBAN → "PT50****1234")
 */
export function maskPII(value: string, visibleStart = 4, visibleEnd = 4): string {
  if (!value || value.length <= visibleStart + visibleEnd) return value;
  const start = value.slice(0, visibleStart);
  const end = value.slice(-visibleEnd);
  return `${start}${"*".repeat(Math.min(value.length - visibleStart - visibleEnd, 8))}${end}`;
}

/**
 * PII fields the Prisma extension encrypts on write and decrypts on read.
 *
 * **This is not the complete list of encrypted PII in the schema, and must not be read as one.**
 * `BankAccount.iban` is encrypted too, but at the call site in
 * `lib/services/bank/consent.ts` rather than through this extension — deliberately, and it should
 * stay that way:
 *
 *   - nothing needs the plaintext. Matching uses `BankAccount.ibanHash` ("matching without
 *     decryption", per the schema comment) and display uses `ibanLast4`;
 *   - adding it here would make the extension decrypt on read, and `app/api/debug/db/route.ts`
 *     selects `accounts: true` — so a field that is currently write-only ciphertext would start
 *     leaving that route in plaintext.
 *
 * So the rule for this table is narrower than "what is encrypted": it is "what is encrypted AND
 * needs to come back". Anything encrypted at a call site belongs in this note instead.
 */
export const PII_FIELDS: Record<string, string[]> = {
  Owner: ["taxIdentificationNumber", "phone"],
  Tenant: ["phone"],
  RentReceipt: ["landlordNif", "tenantNif"],
};
