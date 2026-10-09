import { getPrismaClient } from "@/lib/services/database/database";

/**
 * When an account's sessions began to count (`User.sessionsValidFrom`), and whether one still does.
 *
 * Turning the second factor on stamps the account with the moment, and every session signed in
 * before it is over: a password that was already stolen, or a cookie already copied, stops working
 * at the instant the owner adds the second factor. That is the point of adding it.
 *
 * A session's sign-in time is `token.signedAt`, set once at sign-in and never renewed by a refresh.
 * NextAuth's own `iat` cannot stand in for it: it is rewritten every time the token is re-encoded,
 * so a session that had been refreshed after the stamp would look new. A token with no `signedAt`
 * was minted before this existed, so it is older than any stamp.
 *
 * The stamp is read on each refresh of a token (every API call and every session poll), so it is
 * kept in this process for a few seconds. The route that sets it writes it here as well, which makes
 * the change immediate on this process; this app runs as one.
 */

const TTL_MS = 5_000;
const MAX_ENTRIES = 500;

interface Entry {
  readAt: number;
  validFrom: number | null;
}

const cache = new Map<string, Entry>();

function remember(userId: string, validFrom: number | null, now: number): void {
  // Insertion order is age order: when full, the oldest goes first.
  cache.delete(userId);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(userId, { readAt: now, validFrom });
}

/** The stamp as milliseconds, or null while the account has none. Throws when it cannot be read. */
export async function readSessionsValidFrom(
  userId: string,
  now: number = Date.now(),
): Promise<number | null> {
  const hit = cache.get(userId);
  if (hit && now - hit.readAt < TTL_MS) return hit.validFrom;

  const row = await getPrismaClient().user.findUnique({
    where: { id: userId },
    select: { sessionsValidFrom: true },
  });
  const validFrom = row?.sessionsValidFrom ? row.sessionsValidFrom.getTime() : null;
  remember(userId, validFrom, now);
  return validFrom;
}

/** Called by the route that writes the stamp, so this process sees it before the cache would. */
export function rememberSessionsValidFrom(
  userId: string,
  validFrom: Date,
  now: number = Date.now(),
): void {
  remember(userId, validFrom.getTime(), now);
}

/** True when the session was signed in before the account's stamp. */
export function sessionEnded(signedAt: unknown, validFrom: number | null): boolean {
  if (validFrom === null) return false;
  return typeof signedAt !== "number" || !Number.isFinite(signedAt) || signedAt < validFrom;
}

/** For tests. */
export function clearSessionEpochCache(): void {
  cache.clear();
}
