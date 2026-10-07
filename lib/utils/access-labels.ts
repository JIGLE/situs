import type { SignInStatus } from "@/lib/services/admin/sign-in-status";
import type { AccountSummary } from "@/lib/services/auth/accounts";
import type { InvitedRole } from "@/lib/services/auth/sign-up";

/**
 * Catalogue key for a role, under `admin.access`. Two lists show one (the invitations and the
 * accounts), and a stored role is not a label: `ADMIN` printed as it is stored reads as a code in
 * every language. The `Record` makes a role without a label a compile error rather than a word that
 * renders as itself. `USER` is what an account that was never promoted still holds; no screen gives
 * it, and every owner route refuses it.
 */
export const ACCESS_ROLE_KEY = {
  ADMIN: "roles.ADMIN",
  MANAGER: "roles.MANAGER",
  USER: "roles.USER",
} as const satisfies Record<AccountSummary["role"], string>;

/**
 * The roles a screen can give, in the order a select lists them: the one that can do less first, so
 * an invitation sent in a hurry is not an administrator's.
 */
export const ASSIGNABLE_ROLES: readonly InvitedRole[] = ["MANAGER", "ADMIN"];

/** The role a value from a select names, or undefined when it names none that can be given. */
export function assignableRole(value: string): InvitedRole | undefined {
  return ASSIGNABLE_ROLES.find((role) => role === value);
}

/**
 * How each registration state reads, as keys under `admin.signIn`, for the two screens that show it
 * (the overview and Admin › Acessos). `open` says whether the state lets a person nobody named
 * create an account, which both screens tint as a warning: the first sign-in claims the instance,
 * and any verified Google account becomes a manager. A person who was invited is no stranger.
 */
export const REGISTRATION_COPY = {
  open_bootstrap: { title: "registrationOpen", help: "registrationOpenHelp", open: true },
  google: { title: "registrationGoogle", help: "registrationGoogleHelp", open: true },
  invitations: {
    title: "registrationInvitations",
    help: "registrationInvitationsHelp",
    open: false,
  },
  closed: { title: "registrationClosed", help: "registrationClosedHelp", open: false },
} as const satisfies Record<
  SignInStatus["registration"],
  { title: string; help: string; open: boolean }
>;
