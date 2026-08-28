/**
 * The consent handshake for a live bank connection.
 *
 * This lives in a service rather than in the two route handlers because it is the security-
 * sensitive half of the integration and deserves tests of its own. The flow leaves the app: we
 * send the user to their bank, and some time later a redirect comes back claiming a consent
 * completed. Everything here exists to make sure that claim can only be made by the account that
 * started it, once.
 */

import crypto from "crypto";

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { encryptPII } from "@/lib/utils/pii-encryption";
import { hashIban } from "./import";
import {
  configuredProviders,
  getBankProvider,
  getProviderForConnection,
  providerColumnValue,
} from "./providers/registry";
import type { ProviderAccount } from "./providers/types";

/** How long a consent is requested for. Providers clamp; the adapter clamps again. */
const ACCESS_VALID_DAYS = 90;

/** History requested on first connection — two years where the bank offers it. */
const MAX_HISTORICAL_DAYS = 730;

export class ConsentFlowError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ConsentFlowError";
    this.status = status;
  }
}

interface ConnectionMetadata {
  reference?: string;
  accountRefs?: Record<string, string>;
  /**
   * A connection the operator created deliberately to prove the chain works, from /admin.
   *
   * It is a label, not a mode. The consent, the provider call, the account persistence and the
   * import pipeline are all identical to a real connection — a test that took a different path
   * would prove nothing about the path that matters. What the flag buys is that /admin can show
   * it as a test run and offer to delete it, so a sandbox trial does not sit in Settings
   * indefinitely looking like a bank someone connected on purpose.
   */
  isTest?: boolean;
}

/** Read the test marker off a connection row without caring how metadata is shaped elsewhere. */
export function isTestConnection(metadataRaw: string | null): boolean {
  return readMetadata(metadataRaw).isTest === true;
}

function readMetadata(raw: string | null): ConnectionMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ConnectionMetadata;
  } catch {
    return {};
  }
}

/** Absolute URL the bank returns the user to. Must match what the provider has registered. */
export function callbackUrl(): string {
  const base = process.env.NEXTAUTH_URL?.replace(/\/+$/, "");
  if (!base) {
    throw new ConsentFlowError("NEXTAUTH_URL must be set to connect a bank", 503);
  }
  return `${base}/api/bank/connections/callback`;
}

export interface StartedConsent {
  connectionId: string;
  url: string;
}

/**
 * Begin a connection: create the pending row, then ask the provider for a consent link.
 *
 * The row is created FIRST so a reference always has something to come back to. If the provider
 * call then fails, a `pending_consent` row is left behind with no consent id — harmless, never
 * syncable, and visible as an unfinished attempt rather than silently lost.
 */
export async function startConsent(
  userId: string,
  input: {
    country: string;
    institutionId: string;
    institutionName: string;
    /** Which provider to consent through. Required once an instance can have more than one. */
    providerKey: string;
    /** Label this as a deliberate test run. Does not change the flow — see ConnectionMetadata. */
    isTest?: boolean;
  },
): Promise<StartedConsent> {
  const available = configuredProviders();
  if (available.length === 0) {
    throw new ConsentFlowError("No bank data provider is configured on this instance", 503);
  }

  // Validated against the configured set rather than taken on trust, and rather than the
  // `const [providerKey] = configuredProviders()` this used to do — first-wins silently ignored
  // the caller's choice, so on an instance with two providers the picker would send you to
  // whichever sorted first.
  const providerKey = input.providerKey.trim().toLowerCase();
  if (!available.includes(providerKey)) {
    throw new ConsentFlowError("That bank data provider is not available on this instance", 400);
  }
  const provider = getBankProvider(providerKey);
  if (!provider) {
    throw new ConsentFlowError("Bank provider unavailable", 503);
  }

  const prisma = getPrismaClient();

  // 32 bytes, so the reference cannot be guessed. It is the only thing tying a returning consent
  // to the account that started it, and the callback is a plain GET the bank triggers.
  const reference = crypto.randomBytes(32).toString("hex");

  const connection = await prisma.bankConnection.create({
    data: {
      userId,
      provider: providerColumnValue(providerKey),
      institutionName: input.institutionName,
      status: "pending_consent",
      consentScope: "details,transactions",
      metadata: JSON.stringify(
        (input.isTest ? { reference, isTest: true } : { reference }) satisfies ConnectionMetadata,
      ),
    },
  });

  const link = await provider.createConsentLink({
    institutionId: input.institutionId,
    redirectUrl: callbackUrl(),
    reference,
    accessValidForDays: ACCESS_VALID_DAYS,
    maxHistoricalDays: MAX_HISTORICAL_DAYS,
  });

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: { consentId: link.providerRef, consentExpiresAt: link.expiresAt },
  });

  await logAudit({
    userId,
    action: "BANK_CONNECTION_CREATED",
    resourceType: "bank_connection",
    resourceId: connection.id,
    details: {
      institutionName: input.institutionName,
      country: input.country,
      isTest: input.isTest === true,
    },
  });

  return { connectionId: connection.id, url: link.url };
}

/** Constant-time compare of two hex references of equal length. */
function referenceMatches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Finish a consent the bank has redirected back from.
 *
 * Three guards, all load-bearing:
 *  - the reference is unguessable, so a callback cannot be forged;
 *  - the connection must belong to the signed-in user, so a reference lifted from someone else's
 *    redirect cannot attach their bank to your account;
 *  - only a `pending_consent` row is accepted, so replaying the URL does nothing.
 */
export interface CompletedConsent {
  connectionId: string;
  /**
   * Whether this was a deliberate test run, so the caller can send the operator back where they
   * started. Returned rather than looked up again: this function already holds the row, and a
   * second query for a flag it just read would be the caller re-deriving what it was told.
   */
  isTest: boolean;
}

export async function completeConsent(
  userId: string,
  reference: string,
  callbackParams: Readonly<Record<string, string>> = {},
): Promise<CompletedConsent> {
  if (!reference) {
    throw new ConsentFlowError("Missing consent reference");
  }

  const prisma = getPrismaClient();

  // Scoped to the caller at the query. The candidate set is one row in practice.
  const pending = await prisma.bankConnection.findMany({
    where: { userId, status: "pending_consent" },
  });

  const connection = pending.find((row) => {
    const stored = readMetadata(row.metadata).reference;
    return stored ? referenceMatches(stored, reference) : false;
  });

  if (!connection) {
    // Deliberately the same message whether the reference is unknown, already used, or belongs to
    // another account — distinguishing them would confirm a valid reference to whoever guessed it.
    throw new ConsentFlowError("This bank connection request is no longer valid", 404);
  }
  const provider = getProviderForConnection(connection.provider);
  if (!provider) {
    throw new ConsentFlowError("Bank provider unavailable", 503);
  }

  // No `consentId` check here any more. It used to reject a connection without one as "never
  // reached the bank", which was true for a provider that mints its id at consent-start — and
  // wrong for one that returns only a URL and mints the id in exchange for a callback code.
  // Whether the pieces are sufficient is the adapter's question, so it is asked there.
  const accounts = await provider.completeConsent({
    providerRef: connection.consentId,
    callbackParams,
  });
  await persistAccounts(userId, connection.id, accounts);

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: { status: "active" },
  });

  await logAudit({
    userId,
    action: "BANK_CONSENT_GRANTED",
    resourceType: "bank_connection",
    resourceId: connection.id,
    details: { institutionName: connection.institutionName, accounts: accounts.length },
  });

  return { connectionId: connection.id, isTest: isTestConnection(connection.metadata) };
}

/**
 * Persist the accounts a consent granted.
 *
 * IBANs are encrypted at rest and matched on a hash, the same treatment CSV import gives a
 * counterparty IBAN — so nothing in the matching path ever needs to decrypt. The provider's own
 * account id goes into the connection's metadata rather than a column, because it is
 * provider-specific and `BankAccount` is shared with manual import, which has no such id.
 */
async function persistAccounts(
  userId: string,
  connectionId: string,
  accounts: ProviderAccount[],
): Promise<void> {
  const prisma = getPrismaClient();
  const accountRefs: Record<string, string> = {};

  for (const account of accounts) {
    const ibanHash = account.iban ? hashIban(account.iban) : null;

    // The unique key is (connectionId, ibanHash), so reconnecting the same bank updates the
    // existing account rather than creating a second one that splits its movement history.
    const existing = ibanHash
      ? await prisma.bankAccount.findFirst({ where: { connectionId, ibanHash } })
      : null;

    const data = {
      label: account.label,
      currency: account.currency ?? "EUR",
      isActive: true,
      ...(account.iban
        ? {
            iban: encryptPII(account.iban),
            ibanHash,
            ibanLast4: account.iban.slice(-4),
          }
        : {}),
    };

    const saved = existing
      ? await prisma.bankAccount.update({ where: { id: existing.id }, data })
      : await prisma.bankAccount.create({ data: { ...data, connectionId, userId } });

    accountRefs[saved.id] = account.id;
  }

  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
  const metadata = readMetadata(connection?.metadata ?? null);

  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: {
      // The reference is dropped once spent: keeping it would leave a usable token on a row that
      // is no longer pending, and it has no second purpose.
      metadata: JSON.stringify({
        accountRefs: { ...(metadata.accountRefs ?? {}), ...accountRefs },
      } satisfies ConnectionMetadata),
    },
  });
}
