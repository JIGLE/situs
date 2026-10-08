import crypto from "crypto";

/**
 * How an IBAN is recognised without being read: a keyed hash.
 *
 * The matching columns (`BankAccount.ibanHash`, `BankTransaction.counterpartyIbanHash`,
 * `PayerAccount.ibanHash`, an `iban_hash` reconciliation rule) used to hold a plain SHA-256 of the
 * normalised IBAN. A Portuguese IBAN has about a billion candidates per bank and branch, so anyone
 * holding the database file could hash them all and read the IBANs back, which undid the AES
 * encryption on the `iban` columns beside them. A hash is pseudonymisation only while whatever turns
 * it back into the number is kept apart from it (GDPR art. 4(5), recital 26, art. 32(1)(a)).
 *
 * So the stored value is `v2:` + HMAC-SHA256(key, SHA-256(IBAN)), where the key is derived with HKDF
 * from `PII_ENCRYPTION_KEY`, which lives in the environment and never in the file. Equality still
 * works: the same IBAN gives the same value, which is all matching reads.
 *
 * Built on the plain SHA-256 (not on the IBAN) so that every value already stored converts without
 * the IBAN: `keyedIbanHash(storedPlainHash)` is what `hashIban(iban)` would have produced. That is
 * the migration (`iban-hash-migration.ts`), and it is why `BankAccount.iban` is still never decrypted.
 *
 * Without a key the value stays the plain hash, exactly as before. Such an instance also stores its
 * IBANs unencrypted (the server refuses to start production like that unless told not to), so there
 * is nothing the key would protect, and setting a key later converts what is there at the next start.
 *
 * Changing `PII_ENCRYPTION_KEY` changes every hash: nothing recognises a known account until the old
 * key is back. PII encryption has no rotation either, and Admin › Status says when the key is gone.
 */

/** Marks a value made with the key. A stored hash without it is the plain one. */
export const KEYED_IBAN_HASH_PREFIX = "v2:";

const KEY_LABEL = "situs/iban-hash/v2";

let derived: { source: string; key: Buffer } | null = null;

function hashKey(): Buffer | null {
  const hex = process.env.PII_ENCRYPTION_KEY;
  // Hex, at least 32 bytes: anything else is not a key, and `Buffer.from` would quietly cut it short.
  if (!hex || !/^[0-9a-fA-F]{64,}$/.test(hex)) return null;
  if (derived?.source !== hex) {
    const key = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(hex, "hex"), "", KEY_LABEL, 32));
    derived = { source: hex, key };
  }
  return derived.key;
}

/** Whether hashes are being keyed: false on an instance that has no PII key. */
export function ibanHashKeyConfigured(): boolean {
  return hashKey() !== null;
}

/** The plain hash: SHA-256 of the IBAN without spaces, upper case. What was stored before. */
export function plainIbanHash(iban: string): string {
  const normalized = iban.replace(/\s+/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Whether a stored value was made with the key. */
export const isKeyedIbanHash = (value: string): boolean => value.startsWith(KEYED_IBAN_HASH_PREFIX);

/**
 * A plain hash as it is stored once keyed; a value that is keyed already is returned as it is. With
 * no key it is the plain hash, unchanged.
 */
export function keyedIbanHash(plainHash: string): string {
  if (isKeyedIbanHash(plainHash)) return plainHash;
  const key = hashKey();
  if (!key) return plainHash;
  return KEYED_IBAN_HASH_PREFIX + crypto.createHmac("sha256", key).update(plainHash).digest("hex");
}

/** What is stored, and compared, for an IBAN. */
export function hashIban(iban: string): string {
  return keyedIbanHash(plainIbanHash(iban));
}
