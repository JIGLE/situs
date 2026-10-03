/**
 * Who is allowed to sign in.
 *
 * THE HOLE THIS CLOSES. The OAuth `signIn` callback ended in an unconditional `return true`, and
 * the JWT callback provisioned every new OAuth identity with `role: "ADMIN"` hardcoded. On a
 * publicly reachable instance with Google configured — which a live bank connection requires,
 * because the provider has to reach the consent callback — anyone who found the URL and clicked
 * "Sign in with Google" received an administrator account. Their own data stayed scoped to them,
 * so nothing leaked in the other direction; the exposure is that a self-hosted instance silently
 * accumulated other people's names and email addresses, making its operator a data controller for
 * strangers.
 *
 * THE POLICY. First user wins, then closed, unless the owner has opened a door:
 *
 *   - an email that already has a `User` row signs in as it always did, before anything below is
 *     read, so no setting can lock out a person who already has an account;
 *   - if there are NO users at all, this is first-run bootstrap: allow it, and that account
 *     becomes the administrator;
 *   - an email in `AUTH_ALLOWED_EMAILS` may create an account, as an administrator;
 *   - an email the owner invited (`sign-up.ts`) may create one, as the role it was invited with,
 *     while the invitations switch is on and the invitation has not lapsed;
 *   - any Google account may create one, as a manager, while the Google sign-up switch is on;
 *   - anyone else is refused.
 *
 * The two switches and the invitations are read only for someone who is none of the first three,
 * and a read that fails is the closed answer: an unreadable setting never opens a door.
 *
 * The last two doors admit an identity on the strength of its email, so the provider has to say it
 * verified that email (Google's `email_verified`). Without it, anyone could open a Google account
 * claiming an invited address, or fill the instance with accounts under addresses they do not own.
 * The first account and the allowlist are the operator's own configuration and need no such claim.
 *
 * `AUTH_ALLOWED_EMAILS` is the escape hatch for deliberately adding a second person, because
 * "closed forever after the first sign-in" with no way back is how someone ends up editing the
 * database by hand. It is additive and optional, and it needs no database setting to work.
 *
 * WHY IT REFUSES RATHER THAN CREATING A LESSER ACCOUNT. A stranger with a working login on a
 * private rent ledger is a support question and a data-protection obligation even when they can
 * see nothing. Refusing costs the legitimate second user one config line; admitting them costs
 * the operator a GDPR relationship they never agreed to.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import {
  findLiveInvitation,
  normalizeEmail,
  readSignUpSettings,
  type InvitedRole,
  type SignUpSettings,
} from "@/lib/services/auth/sign-up";

/** Why a sign-in was let through, and for a new account, as what. */
export type SignInDecision =
  | { allow: true; reason: "existing_user" }
  | { allow: true; reason: "bootstrap" | "allowlisted"; role: "ADMIN" }
  | { allow: true; reason: "invited"; role: InvitedRole; invitationId: string }
  | { allow: true; reason: "open_google"; role: "MANAGER" }
  /** `email_unverified`: a door was open for this identity, but its email is not verified. */
  | { allow: false; reason: "registration_closed" | "email_unverified" };

/** Emails permitted in addition to existing users. Absent or blank means "nobody extra". */
export function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Decide whether `email` may sign in, and if it is a new account, as what.
 *
 * Takes the counts and settings it needs rather than reading them, so the policy is a pure function
 * and the cases below can be enumerated without a database. `resolveSignIn` does the reading.
 * `settings` is null when they could not be read, which is both switches off; an omitted one is the
 * same, and so is an omitted `invitation`. `emailVerified` is the provider's claim about the email:
 * only `true` counts, so an omitted one is an unverified email.
 */
export function decideSignIn(input: {
  email: string;
  userExists: boolean;
  totalUsers: number;
  allowed: string[];
  provider?: string;
  emailVerified?: boolean;
  settings?: SignUpSettings | null;
  invitation?: { id: string; role: InvitedRole } | null;
}): SignInDecision {
  if (input.userExists) return { allow: true, reason: "existing_user" };

  // Bootstrap. Checked before the allowlist so a first run needs no configuration at all.
  if (input.totalUsers === 0) return { allow: true, reason: "bootstrap", role: "ADMIN" };

  if (input.allowed.includes(normalizeEmail(input.email))) {
    return { allow: true, reason: "allowlisted", role: "ADMIN" };
  }

  const invitation = input.settings?.invitations ? input.invitation : null;
  // Only Google: this switch is named for it, and a provider added later is not opened by it.
  const googleOpen = Boolean(input.settings?.googleSignUp) && input.provider === "google";

  if (invitation || googleOpen) {
    // Both doors admit an identity by its email, so the provider must have verified it.
    if (input.emailVerified !== true) return { allow: false, reason: "email_unverified" };

    // An invitation outranks open sign-up: someone invited as an administrator is one, whether or
    // not the Google door is also open.
    if (invitation) {
      return { allow: true, reason: "invited", role: invitation.role, invitationId: invitation.id };
    }
    return { allow: true, reason: "open_google", role: "MANAGER" };
  }

  return { allow: false, reason: "registration_closed" };
}

/**
 * The same decision, against the database.
 *
 * Fails CLOSED. A database that cannot be read must not open the door: an outage would otherwise
 * become an unauthenticated-signup window, which is the opposite of what this exists for. The
 * caller logs; the user sees the ordinary sign-in failure. The switches and the invitations are
 * read only for an email that is none of an existing account, the first one or an allowlisted one,
 * and a failure to read them closes those two doors without touching the rest.
 */
export async function resolveSignIn(
  email: string,
  provider?: string,
  emailVerified?: boolean,
): Promise<SignInDecision> {
  const prisma = getPrismaClient();
  const [existing, totalUsers] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.count(),
  ]);
  const allowed = allowedEmails();

  const needsSettings = !existing && totalUsers > 0 && !allowed.includes(normalizeEmail(email));
  const [settings, invitation] = needsSettings
    ? await Promise.all([readSignUpSettings(), findLiveInvitation(email)])
    : [null, null];

  return decideSignIn({
    email,
    userExists: Boolean(existing),
    totalUsers,
    allowed,
    provider,
    emailVerified,
    settings,
    invitation,
  });
}

/** Whether Prisma refused a write because the row is already there. */
const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === "P2002";

/**
 * The account a sign-in is for: the one that exists, or the one the gate lets it create, with the
 * role the decision gave it. Runs where the session is minted, after the `signIn` callback let the
 * identity through, and decides again, so the role of a new account comes from the policy as it
 * stands now and never from a default.
 *
 * An existing account is returned as it is, whatever role it holds: a sign-in is not a promotion.
 * Creating one and using up the invitation it came from are one transaction, and two sign-ins of
 * the same new email at once make one account. Anything this cannot admit throws, and the sign-in
 * fails with it.
 */
export async function provisionAccount(input: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider?: string;
  /** What the provider says of the email: only `true` opens an invitation or Google sign-up. */
  emailVerified?: boolean;
}): Promise<{ id: string; role: string }> {
  const prisma = getPrismaClient();
  const find = () =>
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true, role: true } });

  const existing = await find();
  if (existing) return existing;

  const decision = await resolveSignIn(input.email, input.provider, input.emailVerified);
  if (!decision.allow) {
    throw new Error(
      decision.reason === "email_unverified" ? "EMAIL_UNVERIFIED" : "REGISTRATION_CLOSED",
    );
  }
  if (decision.reason === "existing_user") {
    // Created by another sign-in between the read above and the decision.
    const raced = await find();
    if (raced) return raced;
    throw new Error("REGISTRATION_CLOSED");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.user.create({
        data: {
          email: input.email,
          name: input.name ?? undefined,
          image: input.image ?? undefined,
          role: decision.role,
          imageConsent: true,
        },
        select: { id: true, role: true },
      });
      if (decision.reason === "invited") {
        await tx.accessInvitation.deleteMany({ where: { id: decision.invitationId } });
      }
      return row;
    });

    await logAudit({
      userId: created.id,
      action: "CREATE_ACCOUNT",
      resourceType: "user",
      resourceId: created.id,
      details: { reason: decision.reason, role: created.role },
    });
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await find();
      if (raced) return raced;
    }
    throw error;
  }
}
