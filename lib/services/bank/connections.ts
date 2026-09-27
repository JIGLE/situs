/**
 * The owner's hand on a bank connection once it exists: telling the bank to end its access.
 *
 * Kept apart from `consent.ts`, which begins and finishes consents, and from `sync.ts`, which
 * reads movements. Ending a consent is the one call here that reaches the bank, and it must never
 * be the reason an owner's action fails: the connection has already stopped syncing by the time
 * it runs. So it reports how it went instead of throwing, and the caller decides what to keep.
 */

import { logger } from "@/lib/utils/logger";
import { getProviderForConnection } from "./providers/registry";
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
