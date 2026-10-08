/**
 * Single source of truth for whether the demo credentials provider is available.
 *
 * There used to be two: the NextAuth provider checked `ENABLE_DEMO_LOGIN` on the server while the
 * sign-in form checked `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` in the browser. Only the former was
 * documented, so following the README in production produced the worst arrangement of the two —
 * the provider live and accepting the published demo credentials for a real ADMIN session, while
 * the form that would have revealed it stayed hidden.
 *
 * Server-only on purpose. `NEXT_PUBLIC_*` values are baked into the bundle at build time, which is
 * wrong for a self-hosted image where the operator sets configuration at run time. The sign-in
 * pages are server components; they call this and pass the result down as a prop.
 */
/** The account the published demo credentials sign in as. */
export const DEMO_LOGIN_EMAIL = "demo@situs.local";

export function isDemoLoginEnabled(): boolean {
  if (process.env.ENABLE_DEMO_LOGIN === "true") return true;
  // Outside production the credentials path is a convenience, not a risk.
  return process.env.NODE_ENV !== "production";
}
