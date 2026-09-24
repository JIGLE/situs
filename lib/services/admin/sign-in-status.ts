/**
 * What the sign-in path is actually doing, for the admin area.
 *
 * READ-ONLY BY DESIGN, and the reason is worth keeping. The obvious version of this screen is a
 * row of toggles — disable Google, disable credentials. Two problems: disabling the provider you
 * are currently signed in with locks you out of the instance with no UI to undo it, and storing
 * auth policy in the database puts the sign-in path behind the thing it has to read in order to
 * let you in. So this reports, and configuration stays in the environment where a restart can fix
 * a mistake.
 *
 * Everything here is DERIVED — from environment presence and row counts — never asserted. Same
 * rule as `bankCheck` in `system-status.ts`, and for the same reason: a page that states a fact
 * about what exists becomes a lie the moment that stops being true.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { allowedEmails } from "@/lib/services/auth/registration";

export interface SignInStatus {
  /**
   * Providers compiled in, and whether this instance has credentials for each. Each key names its
   * label, `admin.signIn.provider.<key>`.
   */
  providers: { key: "credentials" | "google"; configured: boolean }[];
  /**
   * Registration state, derived from the account count rather than from a setting.
   * `open_bootstrap` means no account exists yet, so the next sign-in claims the instance.
   */
  registration: "open_bootstrap" | "closed";
  totalAccounts: number;
  adminAccounts: number;
  /** Emails admitted in addition to existing users. Shown so a stale entry is visible. */
  allowlist: string[];
}

const envSet = (name: string) => Boolean(process.env[name]?.trim());

export async function getSignInStatus(): Promise<SignInStatus> {
  const prisma = getPrismaClient();
  const [totalAccounts, adminAccounts] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
  ]);

  return {
    providers: [
      // Always compiled in; an instance can always fall back to it, which is what makes the
      // absence of runtime toggles safe.
      { key: "credentials", configured: true },
      // Loaded dynamically in `auth.ts` — absent credentials, the provider does not exist at all,
      // which is also the fastest way for an operator to close a publicly reachable instance.
      {
        key: "google",
        configured: envSet("GOOGLE_CLIENT_ID") && envSet("GOOGLE_CLIENT_SECRET"),
      },
    ],
    registration: totalAccounts === 0 ? "open_bootstrap" : "closed",
    totalAccounts,
    adminAccounts,
    allowlist: allowedEmails(),
  };
}
