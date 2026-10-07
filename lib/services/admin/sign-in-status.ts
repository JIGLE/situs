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
 * That rule is about PROVIDERS, and it stands. The two sign-up switches and the invitations
 * (`sign-up.ts`) are stored in the database, because neither problem applies to them: they govern
 * NEW accounts only, the gate reads them after an existing account, the first account and the
 * allowlist have been let in, and one that cannot be read counts as closed. None of them stands
 * between a person who has an account and the instance, and `AUTH_ALLOWED_EMAILS` still needs no
 * database at all.
 *
 * Everything here is DERIVED — from environment presence and row counts — never asserted. Same
 * rule as `bankCheck` in `system-status.ts`, and for the same reason: a page that states a fact
 * about what exists becomes a lie the moment that stops being true.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { allowedEmails } from "@/lib/services/auth/registration";
import { countLiveInvitations, readSignUpSettings } from "@/lib/services/auth/sign-up";

export interface SignInStatus {
  /**
   * Providers compiled in, and whether this instance has credentials for each. Each key names its
   * label, `admin.signIn.provider.<key>`.
   */
  providers: { key: "credentials" | "google"; configured: boolean }[];
  /**
   * How a new account can come to be, derived from the account count, the two sign-up switches and
   * the invitations still live, never from a label:
   *   - `open_bootstrap`: no account exists yet, so the next sign-in claims the instance;
   *   - `google`: any Google account with a verified email may create one (the Google switch);
   *   - `invitations`: an email that has been invited may, while its invitation is live;
   *   - `closed`: nobody new may, the allowlist aside. Also what a setting that cannot be read means.
   */
  registration: "open_bootstrap" | "google" | "invitations" | "closed";
  /** Invitations that have not lapsed, whether or not the invitations switch is on. */
  pendingInvitations: number;
  totalAccounts: number;
  adminAccounts: number;
  /** Emails admitted in addition to existing users. Shown so a stale entry is visible. */
  allowlist: string[];
}

const envSet = (name: string) => Boolean(process.env[name]?.trim());

export async function getSignInStatus(): Promise<SignInStatus> {
  const prisma = getPrismaClient();
  const [totalAccounts, adminAccounts, settings, pendingInvitations] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
    readSignUpSettings(),
    countLiveInvitations(),
  ]);

  const registration: SignInStatus["registration"] =
    totalAccounts === 0
      ? "open_bootstrap"
      : settings?.googleSignUp
        ? "google"
        : settings?.invitations && pendingInvitations > 0
          ? "invitations"
          : "closed";

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
    registration,
    pendingInvitations,
    totalAccounts,
    adminAccounts,
    allowlist: allowedEmails(),
  };
}
