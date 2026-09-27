/**
 * A bank connection's `metadata` column: one reader and one writer.
 *
 * Provider-specific state lives here rather than in columns because `BankConnection` is shared
 * with manual rows, which have none of it. It used to be parsed in three places and written in
 * one, and that writer replaced the whole object with the part it knew about — which is how a
 * completed test run lost its marker. Every write now starts from what was read.
 *
 * Pure: no Prisma, so the import pipeline, the consent flow and the connection service can all
 * use it without importing one another.
 */

/** How long a consent reference can be used once minted, first consent or renewal alike. */
export const CONSENT_REFERENCE_TTL_HOURS = 24;

export interface ConnectionMetadata {
  /** A first consent's reference, while the row is `pending_consent`. Dropped once spent. */
  reference?: string;
  /** The provider's own id for each account: `{ <bankAccountId>: <providerAccountId> }`. */
  accountRefs?: Record<string, string>;
  /**
   * A connection the operator created deliberately to prove the chain works, from /admin.
   *
   * It is a label, not a mode. The consent, the provider call, the account persistence and the
   * import pipeline are all identical to a real connection — a test that took a different path
   * would prove nothing about the path that matters. What the flag buys is that /admin can show
   * it as a test run and offer to delete it, and that its sandbox movements never allocate.
   */
  isTest?: boolean;
  /** The bank's id at the provider, needed to open a consent for the same bank again. */
  institutionId?: string;
  /**
   * A renewal in progress: a second consent flow for this same connection. Parked here so the
   * connection keeps working, unchanged, until the bank grants the new consent.
   */
  renewal?: {
    reference: string;
    /** ISO time the renewal started; the reference lapses `CONSENT_REFERENCE_TTL_HOURS` later. */
    startedAt: string;
    /** What `createConsentLink` returned as the consent's reference, if anything. */
    providerRef: string | null;
    /** The expiry the provider gave the new consent, to store once it is granted. */
    consentExpiresAt: string | null;
  };
}

/** The metadata on a row, or an empty object for none or for anything unreadable. */
export function readMetadata(raw: string | null): ConnectionMetadata {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ConnectionMetadata)
      : {};
  } catch {
    return {};
  }
}

/** Serialise metadata for the column. Callers build it from what they read, never from scratch. */
export function writeMetadata(metadata: ConnectionMetadata): string {
  return JSON.stringify(metadata);
}

/** Read the test marker off a connection row without caring how metadata is shaped elsewhere. */
export function isTestConnection(metadataRaw: string | null): boolean {
  return readMetadata(metadataRaw).isTest === true;
}

/** The provider's own id for one of the connection's accounts, or null when it has none. */
export function providerAccountRef(
  metadataRaw: string | null,
  bankAccountId: string,
): string | null {
  return readMetadata(metadataRaw).accountRefs?.[bankAccountId] ?? null;
}
