/**
 * The owner's hand on a bank connection once it exists: disconnecting it, and telling the bank to
 * end its access.
 *
 * Kept apart from `consent.ts`, which begins and finishes consents, and from `sync.ts`, which
 * reads movements. Ending a consent is the one call here that reaches the bank, and it must never
 * be the reason an owner's action fails: the connection has already stopped syncing by the time
 * it runs. So it reports how it went instead of throwing, and the caller decides what to keep.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { logger } from "@/lib/utils/logger";
import { readMetadata, writeMetadata } from "./metadata";
import { PSD2_PREFIX, getProviderForConnection } from "./providers/registry";
import type { RevocationResult } from "./providers/types";

/**
 * How asking the bank to end a consent went.
 * - `revoked`, `already_gone`: the bank's access has ended.
 * - `failed`: the provider did not confirm it; keep the id so it can be asked again.
 * - `no_consent_id`: nothing to ask with — a connection made before its id was stored, whose
 *   access ends on its own date or in the bank's app.
 * - `provider_unavailable`: this instance no longer ships the connection's provider.
 */
export type RevocationOutcome =
  RevocationResult | "failed" | "no_consent_id" | "provider_unavailable";

/** Whether the bank's access is known to have ended, so the stored id can be let go. */
export function accessEnded(outcome: RevocationOutcome): boolean {
  return outcome === "revoked" || outcome === "already_gone";
}

/**
 * Ask the connection's provider to end a consent. Never throws.
 *
 * The consent id is never logged: it is the handle a revocation needs, and a log is not where it
 * belongs.
 */
export async function revokeAtBank(
  providerColumn: string,
  consentId: string | null,
): Promise<RevocationOutcome> {
  if (!consentId) return "no_consent_id";
  const provider = getProviderForConnection(providerColumn);
  if (!provider) return "provider_unavailable";
  try {
    return await provider.revokeConsent({ providerRef: consentId });
  } catch (error) {
    logger.warn("A bank consent could not be revoked", {
      provider: providerColumn,
      error: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

/** The fields of a connection that decide what can be done with it. */
interface ConnectionState {
  provider: string;
  status: string;
  consentId: string | null;
}

/**
 * Whether a connection can be disconnected: a bank connection whose first consent completed. Once
 * disconnected, only while its consent is still held and its provider is here to ask, so a
 * refusal can be asked again.
 */
export function canDisconnect(connection: ConnectionState): boolean {
  if (!connection.provider.startsWith(PSD2_PREFIX)) return false;
  if (connection.status === "pending_consent") return false;
  if (connection.status === "revoked") {
    return Boolean(connection.consentId && getProviderForConnection(connection.provider));
  }
  return true;
}

export interface DisconnectedConnection {
  connectionId: string;
  /** How asking the bank went. `accessEnded` says whether its access is known to have ended. */
  revocation: RevocationOutcome;
}

/**
 * Disconnect a bank connection: it stops syncing here, and the bank is asked to end its access.
 * Its accounts and movements stay. They are the owner's records, and renewing the connection
 * later picks the same accounts up again.
 *
 * The status is written first, conditional on the row as read. A sync already running cannot
 * write `expired` over it, because that write is conditional on `active`. A renewal completing at
 * the same moment either lands first, and this answers that the connection changed, or finds its
 * reference gone. Only then is the bank asked, and only a confirmed end lets the stored id go: a
 * refusal keeps it, so disconnecting again asks again.
 */
export async function disconnectConnection(
  userId: string,
  connectionId: string,
  now = new Date(),
): Promise<DisconnectedConnection> {
  const prisma = getPrismaClient();
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) throw new ResourceNotFoundError("Bank connection");
  if (!canDisconnect(connection)) {
    throw new ConflictError(
      "Only a live bank connection can be disconnected",
      "bank_connection_not_live",
    );
  }

  // A renewal parked on the row goes with it, so the bank's redirect cannot bring a disconnected
  // connection back.
  const { renewal: _dropped, ...metadata } = readMetadata(connection.metadata);
  const stopped = await prisma.bankConnection.updateMany({
    where: {
      id: connection.id,
      userId,
      status: connection.status,
      consentId: connection.consentId,
      metadata: connection.metadata,
    },
    data: { status: "revoked", metadata: writeMetadata(metadata) },
  });
  if (stopped.count !== 1) {
    throw new ConflictError(
      "The connection changed; reload and try again",
      "bank_connection_changed",
    );
  }

  const revocation = await revokeAtBank(connection.provider, connection.consentId);
  if (accessEnded(revocation)) {
    // The access ended now. The id has no further use, and is not kept.
    await prisma.bankConnection.updateMany({
      where: { id: connection.id, status: "revoked", consentId: connection.consentId },
      data: { consentId: null, consentExpiresAt: now },
    });
  }

  await logAudit({
    userId,
    action: "BANK_CONNECTION_DISCONNECTED",
    resourceType: "bank_connection",
    resourceId: connection.id,
    details: {
      institutionName: connection.institutionName,
      previousStatus: connection.status,
      revocation,
    },
  });

  return { connectionId: connection.id, revocation };
}

export interface RenamedConnection {
  connectionId: string;
  /** The owner's name for it, or null when the bank's name shows. */
  label: string | null;
}

/**
 * Name a connection: the owner's own name for it, shown instead of the bank's. Any connection,
 * a manual one included. `null` goes back to the bank's name.
 */
export async function renameConnection(
  userId: string,
  connectionId: string,
  label: string | null,
): Promise<RenamedConnection> {
  const prisma = getPrismaClient();
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
    select: { id: true, label: true, institutionName: true },
  });
  if (!connection) throw new ResourceNotFoundError("Bank connection");
  if (connection.label === label) return { connectionId: connection.id, label };

  // Scoped again in the write, so a connection removed meanwhile is not found rather than a 500.
  const renamed = await prisma.bankConnection.updateMany({
    where: { id: connection.id, userId },
    data: { label },
  });
  if (renamed.count !== 1) throw new ResourceNotFoundError("Bank connection");

  await logAudit({
    userId,
    action: "BANK_CONNECTION_RENAMED",
    resourceType: "bank_connection",
    resourceId: connection.id,
    details: { institutionName: connection.institutionName, from: connection.label, to: label },
  });

  return { connectionId: connection.id, label };
}

export interface RemovedConnection {
  connectionId: string;
  /** How asking the bank went; `no_consent_id` for a connection that held no consent. */
  revocation: RevocationOutcome;
}

/**
 * Remove a connection that brought no movements: a bank connected by mistake, or an empty manual
 * row. A connection with movements is refused: they are the owner's records, and disconnecting it
 * keeps them.
 *
 * The schema cascades a connection to its accounts and their movements, so the condition is part
 * of the delete itself. A sync landing movements between a check and a delete would otherwise be
 * deleted with it. A consent the connection held is ended at the bank once the row is gone.
 */
export async function removeConnection(
  userId: string,
  connectionId: string,
): Promise<RemovedConnection> {
  const prisma = getPrismaClient();
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) throw new ResourceNotFoundError("Bank connection");

  const removed = await prisma.bankConnection.deleteMany({
    where: { id: connection.id, userId, accounts: { every: { transactions: { none: {} } } } },
  });
  if (removed.count !== 1) {
    // Gone meanwhile (a second click) is not found; still there means it has movements.
    const stillThere = await prisma.bankConnection.findFirst({
      where: { id: connection.id, userId },
      select: { id: true },
    });
    if (!stillThere) throw new ResourceNotFoundError("Bank connection");
    throw new ConflictError(
      "A connection with movements cannot be removed",
      "bank_connection_has_movements",
    );
  }

  const revocation = await revokeAtBank(connection.provider, connection.consentId);

  await logAudit({
    userId,
    action: "BANK_CONNECTION_REMOVED",
    resourceType: "bank_connection",
    resourceId: connection.id,
    details: {
      institutionName: connection.institutionName,
      label: connection.label,
      previousStatus: connection.status,
      revocation,
    },
  });

  return { connectionId: connection.id, revocation };
}
