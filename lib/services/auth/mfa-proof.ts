import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof that one session's second factor was verified.
 *
 * `POST /api/auth/totp/verify` hands one back when a code is accepted, and the browser gives it to
 * its own session (`update({ mfaProof })`), whose `jwt` callback clears `mfaPending` for a proof
 * made for that session and for nothing else. It used to clear it for any verification of the
 * ACCOUNT in the last five minutes, which let a sign-in with only the password through a minute
 * after the owner's own: it was held at sign-in and released at its first refresh.
 *
 * The proof is a MAC, under the server's secret, over the user and the session's `sid`, so it
 * cannot be made without a code and cannot be used by another session. It lives for a minute:
 * long enough for the browser to hand it over, short enough that a copy is worth nothing.
 */
export const VALID_FOR_MS = 60_000;

const VERSION = "v1";

export interface MfaSession {
  userId: string;
  /** The session's own name (`token.sid`), given at sign-in to a session that is held pending. */
  sid: string;
}

/** A tuple, not a joined string: no choice of user and sid can read as another. */
const mac = (secret: string, { userId, sid }: MfaSession, expires: number): string =>
  createHmac("sha256", secret)
    .update(JSON.stringify(["mfa-proof", VERSION, userId, sid, expires]))
    .digest("base64url");

export function signMfaProof(secret: string, session: MfaSession, now = Date.now()): string {
  if (!secret) throw new Error("A proof cannot be signed without the server's secret");
  const expires = now + VALID_FOR_MS;
  return `${VERSION}.${expires}.${mac(secret, session, expires)}`;
}

/** True only for a proof this secret signed for this user and this session, and not yet expired. */
export function verifyMfaProof(
  secret: string | undefined,
  proof: unknown,
  session: MfaSession,
  now = Date.now(),
): boolean {
  if (!secret || typeof proof !== "string") return false;

  const parts = proof.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return false;

  const expires = Number(parts[1]);
  // The number as it was signed, written the way it was written: no other spelling of it counts.
  if (!Number.isSafeInteger(expires) || String(expires) !== parts[1]) return false;
  // Not expired, and not made for a lifetime longer than a proof has.
  if (expires <= now || expires > now + VALID_FOR_MS) return false;

  const expected = Buffer.from(mac(secret, session, expires));
  const given = Buffer.from(parts[2]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
