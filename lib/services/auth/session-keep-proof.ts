import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof that one session may carry on after the account ended every older session.
 *
 * Turning the second factor on stamps the account (`User.sessionsValidFrom`), and a session signed
 * in before that stamp is over (`session-epoch.ts`). The session that turned it on is the owner's
 * own, so `POST /api/auth/totp/enable` hands it a proof and the browser gives it to its own session
 * (`update({ keepProof })`), whose `jwt` callback then renews the session's sign-in time.
 *
 * Without a proof, `update()` renewing it would let any older session, a stolen cookie among them,
 * step over the stamp by asking. The proof is a MAC over the user and the session's own sign-in
 * time, so it is made only by the enable route, only for the session that sent a valid code, and a
 * minute is all it lives for.
 */
export const VALID_FOR_MS = 60_000;

const VERSION = "v1";

export interface KeptSession {
  userId: string;
  /** `token.signedAt`; 0 for a session signed in before sessions carried one. */
  signedAt: number;
}

/** A tuple, not a joined string: no choice of user and time can read as another. */
const mac = (secret: string, { userId, signedAt }: KeptSession, expires: number): string =>
  createHmac("sha256", secret)
    .update(JSON.stringify(["session-keep-proof", VERSION, userId, signedAt, expires]))
    .digest("base64url");

export function signKeepProof(secret: string, session: KeptSession, now = Date.now()): string {
  if (!secret) throw new Error("A proof cannot be signed without the server's secret");
  const expires = now + VALID_FOR_MS;
  return `${VERSION}.${expires}.${mac(secret, session, expires)}`;
}

/** True only for a proof this secret signed for this user and this session, and not yet expired. */
export function verifyKeepProof(
  secret: string | undefined,
  proof: unknown,
  session: KeptSession,
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
