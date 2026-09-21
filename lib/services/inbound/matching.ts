/**
 * Suggesting who an inbound message came from.
 *
 * This is deliberately the weakest matcher in the app, and the asymmetry with
 * `lib/services/matching/engine.ts` is the point. A bank movement's counterparty is asserted by
 * the bank, so scoring ≥ 0.85 there auto-allocates. An email `From` header is asserted by
 * whoever sent the mail — it costs nothing to forge — so nothing here ever writes `tenantId`.
 * The most it produces is `suggestedTenantId`, which a human confirms in the Inbox.
 *
 * Why that matters beyond the obvious: a message auto-filed against a tenant stops looking like
 * a claim and starts looking like that tenancy's history. Anyone who learns the parse address
 * could then write into a tenant's record — including, say, a fabricated notice to quit — and
 * the only thing distinguishing it from a real one would be a header nobody re-reads.
 */

/** The minimum a candidate needs to expose. Keeps this pure and trivially testable. */
export interface MatchCandidate {
  id: string;
  email: string;
  propertyId?: string | null;
}

export interface SenderMatch {
  tenantId: string;
  propertyId?: string | null;
  /** Why it matched. Shown in the Inbox so the suggestion can be judged, not just accepted. */
  reason: "exact-email";
}

function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Match a sender address to at most one tenant.
 *
 * Exact address equality only. No domain matching, no name similarity, no fuzzy scoring:
 *
 * - **Domain matching** would suggest a tenant for every message from gmail.com.
 * - **Name similarity** reads a display name, which is the single most forgeable field in an
 *   email and is not even checked by SPF or DKIM.
 *
 * An address matching two tenants returns nothing rather than picking one. Two tenants sharing
 * an address is a data-entry mistake or a couple on one lease, and guessing between them puts
 * one person's correspondence in front of the other.
 */
export function matchSender(
  fromAddress: string,
  candidates: readonly MatchCandidate[],
): SenderMatch | null {
  const sender = normaliseAddress(fromAddress);
  if (!sender) return null;

  const matches = candidates.filter((c) => normaliseAddress(c.email) === sender);
  if (matches.length !== 1) return null;

  return {
    tenantId: matches[0].id,
    propertyId: matches[0].propertyId ?? null,
    reason: "exact-email",
  };
}

/**
 * Whether a message's sender checks are strong enough to show the suggestion without a caveat.
 *
 * A `pass` on either SPF or DKIM means some domain took responsibility for the message. That is
 * still not identity — a domain can pass its own checks while lying about the person — so this
 * only decides how the Inbox *presents* the suggestion, never whether one is made.
 */
export function isSenderAuthenticated(
  spfResult?: string | null,
  dkimResult?: string | null,
): boolean {
  return spfResult?.toLowerCase() === "pass" || dkimResult?.toLowerCase() === "pass";
}
