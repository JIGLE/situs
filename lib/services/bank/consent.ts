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
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { encryptPII } from "@/lib/utils/pii-encryption";
import { revokeAtBank, type RevocationOutcome } from "./connections";
import { hashIban } from "@/lib/utils/iban-hash";
import {
  PSD2_PREFIX,
  configuredProviders,
  getBankProvider,
  getProviderForConnection,
  providerColumnValue,
} from "./providers/registry";
import type { BankDataProvider, ProviderAccount } from "./providers/types";
import {
  CONSENT_REFERENCE_TTL_HOURS,
  isTestConnection,
  readMetadata,
  writeMetadata,
  type ConnectionMetadata,
} from "./metadata";

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
      // The bank's id is kept so a renewal can open a consent for the same bank again.
      metadata: writeMetadata({
        reference,
        institutionId: input.institutionId,
        ...(input.isTest ? { isTest: true } : {}),
      } satisfies ConnectionMetadata),
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

/**
 * Renew a connection in place: a second consent flow for the same bank, on the same row.
 *
 * A reconnect used to be a new connection, with new account rows. A movement's fingerprint
 * includes its account, so the new connection's movements missed exact deduplication against the
 * old one's and landed in review as possible duplicates. Renewing keeps the connection and its
 * accounts, so they keep their ids.
 *
 * The new consent is parked in the row's metadata, and nothing the connection works from changes
 * until the bank grants it: an abandoned renewal leaves it exactly as it was.
 */
export async function startRenewal(
  userId: string,
  connectionId: string,
  now = new Date(),
): Promise<StartedConsent> {
  const prisma = getPrismaClient();
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) throw new ResourceNotFoundError("Bank connection");

  // A manual row has no consent to renew, and a pending one has not finished its first.
  if (!connection.provider.startsWith(PSD2_PREFIX) || connection.status === "pending_consent") {
    throw new ConflictError(
      "Only a live bank connection can be renewed",
      "bank_connection_not_live",
    );
  }
  const provider = getProviderForConnection(connection.provider);
  if (!provider || !configuredProviders().includes(provider.key)) {
    throw new ConsentFlowError("Bank provider unavailable", 503);
  }

  const metadata = readMetadata(connection.metadata);
  const institutionId =
    metadata.institutionId ?? (await legacyInstitutionId(userId, connection, provider));
  if (!institutionId) {
    throw new ConflictError(
      "The bank of this connection cannot be found again; connect it anew",
      "bank_connection_renewal_unavailable",
    );
  }

  const reference = crypto.randomBytes(32).toString("hex");
  const link = await provider.createConsentLink({
    institutionId,
    // The same callback as a first consent: the provider compares it with the registered URL.
    redirectUrl: callbackUrl(),
    reference,
    accessValidForDays: ACCESS_VALID_DAYS,
    maxHistoricalDays: MAX_HISTORICAL_DAYS,
  });

  // Conditional on the row as it was read, so a renewal started twice at once parks only one.
  const parked = await prisma.bankConnection.updateMany({
    where: { id: connection.id, userId, metadata: connection.metadata },
    data: {
      metadata: writeMetadata({
        ...metadata,
        institutionId,
        renewal: {
          reference,
          startedAt: now.toISOString(),
          providerRef: link.providerRef,
          consentExpiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        },
      }),
    },
  });
  if (parked.count !== 1) {
    throw new ConflictError(
      "The connection changed; reload and try again",
      "bank_connection_changed",
    );
  }

  return { connectionId: connection.id, url: link.url };
}

/**
 * The bank's id for a connection made before it was stored, found once and never guessed: the
 * country from the connection's own creation record, and the one bank there with its exact name.
 */
async function legacyInstitutionId(
  userId: string,
  connection: { id: string; institutionName: string },
  provider: BankDataProvider,
): Promise<string | null> {
  const created = await getPrismaClient().auditLog.findFirst({
    where: {
      userId,
      action: "BANK_CONNECTION_CREATED",
      resourceType: "bank_connection",
      resourceId: connection.id,
    },
    select: { details: true },
  });
  let country: unknown;
  try {
    country = created?.details
      ? (JSON.parse(created.details) as { country?: unknown }).country
      : null;
  } catch {
    country = null;
  }
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return null;

  const { institutions } = await provider.listInstitutions(country);
  const matches = institutions.filter((bank) => bank.name === connection.institutionName);
  return matches.length === 1 ? matches[0].id : null;
}

/** Whether a reference minted at `mintedAt` can still be used at `now`. */
function referenceFresh(mintedAt: Date, now: Date): boolean {
  return now.getTime() - mintedAt.getTime() < CONSENT_REFERENCE_TTL_HOURS * 60 * 60 * 1000;
}

/** Constant-time compare of two hex references of equal length. */
function referenceMatches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Finish a consent the bank has redirected back from: a first consent, or a renewal.
 *
 * Four guards, all load-bearing:
 *  - the reference is unguessable, so a callback cannot be forged;
 *  - the connection must belong to the signed-in user, so a reference lifted from someone else's
 *    redirect cannot attach their bank to your account;
 *  - the reference is spent in one conditional write before the bank is called, so replaying
 *    the URL, or a double click, does nothing;
 *  - it lapses after a day.
 */
export interface CompletedConsent {
  connectionId: string;
  /**
   * Whether this was a deliberate test run, so the caller can send the operator back where they
   * started. Returned rather than looked up again: this function already holds the row, and a
   * second query for a flag it just read would be the caller re-deriving what it was told.
   */
  isTest: boolean;
  /** Whether this renewed a connection that already existed. */
  renewal: boolean;
}

export async function completeConsent(
  userId: string,
  reference: string,
  callbackParams: Readonly<Record<string, string>> = {},
  now = new Date(),
): Promise<CompletedConsent> {
  if (!reference) {
    throw new ConsentFlowError("Missing consent reference");
  }

  const prisma = getPrismaClient();
  // Deliberately the same answer whether the reference is unknown, already used, expired or
  // belongs to another account: distinguishing them would confirm a valid reference to whoever
  // guessed it.
  const noLongerValid = () =>
    new ConsentFlowError("This bank connection request is no longer valid", 404);

  // Scoped to the caller at the query. A first consent's reference is on a pending row; a
  // renewal's is parked on the live row it renews. A reference lapses after a day, as the
  // retention sweep deletes a pending row that old.
  const candidates = await prisma.bankConnection.findMany({ where: { userId } });
  const match = candidates
    .map((row) => ({ row, metadata: readMetadata(row.metadata) }))
    .find(({ row, metadata }) => {
      if (row.status === "pending_consent") {
        return metadata.reference
          ? referenceMatches(metadata.reference, reference) && referenceFresh(row.createdAt, now)
          : false;
      }
      return metadata.renewal
        ? referenceMatches(metadata.renewal.reference, reference) &&
            referenceFresh(new Date(metadata.renewal.startedAt), now)
        : false;
    });
  if (!match) throw noLongerValid();
  const connection = match.row;
  const renewal = connection.status === "pending_consent" ? null : (match.metadata.renewal ?? null);

  const provider = getProviderForConnection(connection.provider);
  if (!provider) {
    throw new ConsentFlowError("Bank provider unavailable", 503);
  }

  // Spend the reference before calling the bank, in one conditional write: of two callbacks
  // racing (a double click), one claims it and the other finds nothing. Checking the status
  // afterwards left a window in which both reached the provider. If the bank then refuses, a
  // first consent's row stays pending with no reference, and the retention sweep removes it; a
  // renewed connection is left exactly as it was.
  const { reference: _claimed, renewal: _parked, ...unclaimed } = match.metadata;
  const claim = await prisma.bankConnection.updateMany({
    where: {
      id: connection.id,
      userId,
      status: connection.status,
      metadata: connection.metadata,
    },
    data: { metadata: writeMetadata(unclaimed) },
  });
  if (claim.count !== 1) throw noLongerValid();

  // No `consentId` check here any more. It used to reject a connection without one as "never
  // reached the bank", which was true for a provider that mints its id at consent-start — and
  // wrong for one that returns only a URL and mints the id in exchange for a callback code.
  // Whether the pieces are sufficient is the adapter's question, so it is asked there.
  const startedRef = renewal ? renewal.providerRef : connection.consentId;
  const grant = await provider.completeConsent({ providerRef: startedRef, callbackParams });
  const accounts = grant.accounts;
  await persistAccounts(userId, connection.id, accounts);

  // The id the provider minted at completion, when it did (Enable Banking's session), is the one a
  // revocation needs. A provider that minted it at consent-start returned it then.
  const consentId = grant.providerRef ?? startedRef;
  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: {
      status: "active",
      consentId,
      ...(renewal
        ? {
            consentExpiresAt: renewal.consentExpiresAt ? new Date(renewal.consentExpiresAt) : null,
          }
        : {}),
    },
  });

  if (renewal) {
    // The consent it replaces is ended at the bank, once the new one is stored. Best effort: the
    // connection already works from the new one, and a failure is recorded, not raised. A
    // connection made before its id was stored records `no_consent_id`: that consent lapses on its
    // own date, and the record says so rather than nothing.
    const previousConsent: RevocationOutcome | null =
      connection.consentId === consentId
        ? null
        : await revokeAtBank(connection.provider, connection.consentId);
    await logAudit({
      userId,
      action: "BANK_CONSENT_RENEWED",
      resourceType: "bank_connection",
      resourceId: connection.id,
      details: {
        institutionName: connection.institutionName,
        accounts: accounts.length,
        previousStatus: connection.status,
        previousConsent,
      },
    });
  } else {
    await logAudit({
      userId,
      action: "BANK_CONSENT_GRANTED",
      resourceType: "bank_connection",
      resourceId: connection.id,
      details: { institutionName: connection.institutionName, accounts: accounts.length },
    });
  }

  return {
    connectionId: connection.id,
    isTest: isTestConnection(connection.metadata),
    renewal: Boolean(renewal),
  };
}

/**
 * Persist the accounts a consent granted.
 *
 * IBANs are encrypted at rest and matched on a hash, the same treatment CSV import gives a
 * counterparty IBAN — so nothing in the matching path ever needs to decrypt. The provider's own
 * account id goes into the connection's metadata rather than a column, because it is
 * provider-specific and `BankAccount` is shared with manual import, which has no such id.
 *
 * On a renewal the same accounts are found again, so they keep their ids and their movements'
 * fingerprints. The provider ids are replaced, not merged: the old consent's ids stop working
 * once it is revoked, and an account the bank did not grant again stops syncing (its movements
 * stay).
 */
async function persistAccounts(
  userId: string,
  connectionId: string,
  accounts: ProviderAccount[],
): Promise<void> {
  const prisma = getPrismaClient();
  const accountRefs: Record<string, string> = {};
  const granted = new Set<string>();

  for (const account of accounts) {
    const ibanHash = account.iban ? hashIban(account.iban) : null;
    const currency = account.currency ?? "EUR";

    // The unique key is (connectionId, ibanHash), so reconnecting the same bank updates the
    // existing account rather than creating a second one that splits its movement history. An
    // account without an IBAN is found by its name and currency, when exactly one matches.
    const existing = ibanHash
      ? await prisma.bankAccount.findFirst({ where: { connectionId, ibanHash } })
      : await ibanlessAccount(connectionId, account.label, currency, granted);

    const data = {
      label: account.label,
      currency,
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

    granted.add(saved.id);
    accountRefs[saved.id] = account.id;
  }

  await prisma.bankAccount.updateMany({
    where: { connectionId, isActive: true, id: { notIn: [...granted] } },
    data: { isActive: false },
  });

  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
  // Everything already on the row is kept except the spent reference: keeping that would leave a
  // usable token on a row that is no longer pending, and it has no second purpose. This used to
  // write `accountRefs` alone, which also dropped `isTest`. A completed test run then vanished
  // from /admin, could not be deleted as one, and its sandbox movements were no longer kept out
  // of automatic allocation. A renewal started meanwhile is kept too.
  const { reference: _spent, ...metadata } = readMetadata(connection?.metadata ?? null);

  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: { metadata: writeMetadata({ ...metadata, accountRefs }) },
  });
}

/** The one account of a connection with no IBAN, this name and currency, not yet matched. */
async function ibanlessAccount(
  connectionId: string,
  label: string,
  currency: string,
  alreadyMatched: ReadonlySet<string>,
): Promise<{ id: string } | null> {
  const candidates = await getPrismaClient().bankAccount.findMany({
    where: { connectionId, ibanHash: null, label, currency },
    select: { id: true },
  });
  const free = candidates.filter((candidate) => !alreadyMatched.has(candidate.id));
  return free.length === 1 ? free[0] : null;
}
