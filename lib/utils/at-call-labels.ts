import type { AtCodeCategory } from "@/lib/tax/at/codes";

/**
 * The key, under `settings.at`, for an AT answer about the connection rather than the request:
 * the Portal user, the password, the key file, the clock, the request's form, or AT itself.
 *
 * Settings › Integrações shows these after Check credentials and Fetch receipt, and Finanças ›
 * Recibos after a test: one answer, one wording. 0 and −1 are not here, because each call means
 * something different by them, and neither is a code the manual does not list.
 */
export const AT_PROBLEM_KEY = {
  username: "result.username",
  password: "result.password",
  key: "result.key",
  clock: "result.clock",
  request: "result.request",
  at_fault: "result.atFault",
} as const satisfies Record<Exclude<AtCodeCategory, "ok" | "rejected" | "unknown">, string>;
