import { RateLimits, type RateLimitConfig } from "@/lib/middleware/rate-limit";

/**
 * The budget for guessing an account's second-factor code, five tries in fifteen minutes.
 *
 * A six-digit code has a million possibilities, so what is limited is the guesses an account
 * receives, not the guesses a URL receives: the verify route (the sign-in code page) and the
 * disable route (turning the factor off) both take the code, and each with a bucket of its own
 * would give a session twice the tries at the same code, and every route added later one more
 * round. They name the same account and the same scope, so a guess at either is a guess at both.
 */
export const TOTP_CODE_SCOPE = "totp-code";

export function totpGuessLimit(userId: string): RateLimitConfig {
  return {
    ...RateLimits.AUTH,
    identifier: () => `totp-verify:${userId}`,
    scope: TOTP_CODE_SCOPE,
  };
}
