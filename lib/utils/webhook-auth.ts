/**
 * Shared bearer-secret check for provider webhooks.
 *
 * Extracted rather than copied. Brevo signs none of its webhooks — not the delivery events, not
 * inbound parsing — so a shared secret is the only thing in front of both routes, and the two
 * subtleties below are the whole security of it:
 *
 *   - `timingSafeEqual` throws on a length mismatch, so the lengths must be compared first, and
 *     that comparison is itself an oracle for the secret's length. It is accepted: knowing the
 *     length of a random 64-character secret does not help anyone guess it.
 *   - A plain `===` would leak the shared prefix through response timing, which is what makes
 *     the constant-time compare load-bearing rather than decorative.
 *
 * One copy, so a fix reaches both routes. Two hand-written copies of a comparison this fiddly is
 * how one of them ends up subtly wrong and nothing notices — the same argument that removed the
 * duplicate security-headers implementation.
 */

import { timingSafeEqual } from "crypto";

/** Constant-time string equality, false on any length difference. */
export function timingSafeCompare(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * True when the request carries the expected secret, as `Authorization: Bearer <secret>` or as
 * the bare value. Returns false when no secret is configured — callers answer 503 for that case
 * before reaching here, so an unconfigured instance never accidentally reads as authorised.
 */
export function isWebhookAuthorised(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : header;
  return timingSafeCompare(presented, expected);
}
