import { createHmac, timingSafeEqual } from "node:crypto";

import type { RateLimitConfig } from "@/lib/middleware/rate-limit";

/**
 * Passkeys as a second way past the second factor.
 *
 * A passkey does the job the authenticator code does at `/auth/mfa`: it releases a session that has
 * passed its first factor. It does not replace the code, which stays the way to add, remove and
 * recover (a passkey is only offered on an account that has the authenticator app on), and turning
 * the app off removes the passkeys with it. What a passkey changes is the sign-in: one tap with the
 * phone's fingerprint, face or screen lock, nothing to copy.
 *
 * The routes under `app/api/auth/passkey/` hold the ceremony. This file holds what they share.
 */

/** What the browser is told the site is called when it asks to save a passkey. */
export const RP_NAME = "Situs";

/** A challenge is good for two minutes: a person's fingerprint prompt, not a session. */
export const CHALLENGE_VALID_FOR_MS = 2 * 60_000;

const VERSION = "v1";

/**
 * The site a passkey belongs to. A passkey is bound to the domain it was made for, so this is the
 * instance's public address (`NEXTAUTH_URL`, the same one the sign-in callbacks use), never the
 * host a request happens to carry: behind a reverse proxy that is an internal name.
 */
export function relyingParty(): { rpID: string; origin: string } {
  const url = new URL(process.env.NEXTAUTH_URL || "http://localhost:3000");
  return { rpID: url.hostname, origin: url.origin };
}

export type ChallengeKind = "register" | "authenticate";

export interface ChallengeScope {
  kind: ChallengeKind;
  userId: string;
  /** The session's own name (`token.sid`) for a sign-in; a registration is the account's, not a session's. */
  sid?: string;
}

/** A tuple, not a joined string: no choice of fields can read as another. */
const mac = (secret: string, scope: ChallengeScope, challenge: string, expires: number): string =>
  createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "passkey-challenge",
        VERSION,
        scope.kind,
        scope.userId,
        scope.sid ?? null,
        challenge,
        expires,
      ]),
    )
    .digest("base64url");

/**
 * The challenge, signed, so the server need not remember it. It is the one the WebAuthn library put
 * in the options (`options.challenge`), which is what the browser signs: handing the library a
 * challenge of our own does not work, since it re-encodes a string before sending it.
 * The browser holds the token between the
 * two halves of a ceremony and hands it back with the authenticator's answer; the MAC says the
 * challenge was made by this server, for this account (and this sign-in, when there is one), for this
 * kind of ceremony, and not long ago. A sign-in challenge is therefore no use to another session,
 * and a registration challenge cannot answer a sign-in.
 */
export function signChallenge(
  secret: string,
  scope: ChallengeScope,
  challenge: string,
  now = Date.now(),
): string {
  if (!secret) throw new Error("A challenge cannot be signed without the server's secret");
  const expires = now + CHALLENGE_VALID_FOR_MS;
  return `${VERSION}.${expires}.${challenge}.${mac(secret, scope, challenge, expires)}`;
}

/** The challenge a token carries, or null when it was not made for this scope, or has expired. */
export function openChallenge(
  secret: string | undefined,
  token: unknown,
  scope: ChallengeScope,
  now = Date.now(),
): string | null {
  if (!secret || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || String(expires) !== parts[1]) return null;
  // Not expired, and not made for a lifetime longer than a challenge has.
  if (expires <= now || expires > now + CHALLENGE_VALID_FOR_MS) return null;

  const challenge = parts[2];
  const expected = Buffer.from(mac(secret, scope, challenge, expires));
  const given = Buffer.from(parts[3]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return challenge;
}

/**
 * The budget for starting and finishing a passkey sign-in. A passkey cannot be guessed, so this is
 * not a guess budget like `totpGuessLimit`: it only stops a held session from hammering the route.
 * Per account, so a shared network does not lock out one person for another's attempts.
 */
export function passkeySignInLimit(userId: string): RateLimitConfig {
  return {
    maxRequests: 20,
    windowSeconds: 15 * 60,
    identifier: () => `passkey-sign-in:${userId}`,
    scope: "passkey-sign-in",
  };
}

/** What the owner sees of a passkey: never the key, never the credential id. */
export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** True for a passkey the owner's password manager keeps in sync across devices. */
  synced: boolean;
}

export function summarize(row: {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  deviceType: string;
}): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    synced: row.deviceType === "multiDevice",
  };
}

/** A name the owner can read in a list: trimmed, bounded, and never empty. */
export function cleanName(name: unknown, fallback: string): string {
  const text = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return text || fallback;
}

/** How many passkeys one account may hold. Plenty for phones, laptops and a security key. */
export const MAX_PASSKEYS = 10;
