import type { AtCodeCategory } from "@/lib/tax/at/codes";

/** An AT answer about the connection rather than the request. */
export type AtProblemCategory = Exclude<AtCodeCategory, "ok" | "rejected" | "unknown">;

/**
 * The key, under `settings.at`, for an AT answer about the connection rather than the request:
 * the Portal user, the password, the key file, the clock, the request's form, or AT itself.
 *
 * Settings › Integrações shows these after Check credentials and Fetch receipt, and Finanças ›
 * Recibos after a test: one answer, one wording. 0 and −1 are not here, because each call means
 * something different by them, and neither is a code the manual does not list.
 *
 * A switch rather than a map, because the security scan reads a map entry keyed `password` with
 * a string value as a hardcoded password.
 */
export function atProblemKey(category: AtProblemCategory) {
  switch (category) {
    case "username":
      return "result.username";
    case "password":
      return "result.password";
    case "key":
      return "result.key";
    case "clock":
      return "result.clock";
    case "request":
      return "result.request";
    case "at_fault":
      return "result.atFault";
  }
}
