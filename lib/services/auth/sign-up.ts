/**
 * Who may create an account they do not have yet: the two switches and the invitations behind them.
 *
 * These govern NEW accounts and nothing else. `registration.ts` reads them only for someone who is
 * not an existing account, the first account or an allowlisted email, so no setting here can lock
 * out a person who already signs in. A read that fails is the closed answer, never an open one:
 * `readSignUpSettings` returns null and `findLiveInvitation` finds nothing.
 *
 * Every change is audited. The invitee's email is held here until the account exists, the
 * invitation lapses, or the owner withdraws it; the audit trail keeps it masked.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { logger } from "@/lib/utils/logger";

export interface SignUpSettings {
  /** Any Google account may create an account, as a manager. */
  googleSignUp: boolean;
  /** An invited email may create an account, as the role it was invited with. */
  invitations: boolean;
}

/**
 * What a fresh instance does until the owner says otherwise: nothing opens by itself, and an
 * invitation is the deliberate act that admits someone (so that switch is on, with none sent).
 */
export const DEFAULT_SIGN_UP_SETTINGS: SignUpSettings = { googleSignUp: false, invitations: true };

/** The roles an invitation can carry. A USER is refused by every owner route, so it is no invitation. */
export type InvitedRole = "ADMIN" | "MANAGER";

/** How long an invitation admits its email. A standing permission is a hole; this one lapses. */
export const INVITATION_DAYS = 30;

const SETTINGS_ID = "instance";

/** Emails are compared lower-case, as `AUTH_ALLOWED_EMAILS` is. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** `a***@example.org`: enough to recognise who was meant, no more than the audit trail needs. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = normalizeEmail(email).split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: InvitedRole;
  createdAt: string;
  expiresAt: string;
  /** Lapsed: it admits nobody, and the daily retention run removes it. */
  expired: boolean;
}

/**
 * The two switches as stored, or the defaults when nothing was ever saved. Null when they cannot be
 * read, which the gate treats as both closed.
 */
export async function readSignUpSettings(): Promise<SignUpSettings | null> {
  try {
    const row = await getPrismaClient().instanceSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { googleSignUp: true, invitations: true },
    });
    return row ?? DEFAULT_SIGN_UP_SETTINGS;
  } catch (error) {
    logger.error(
      "Could not read the sign-up settings — treating new sign-ups as closed",
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

/** The invitation that admits this email now, if there is one. A failed read finds none. */
export async function findLiveInvitation(
  email: string,
): Promise<{ id: string; role: InvitedRole } | null> {
  try {
    const row = await getPrismaClient().accessInvitation.findFirst({
      where: { email: normalizeEmail(email), expiresAt: { gt: new Date() } },
      select: { id: true, role: true },
    });
    // A row holding any other role is not one this gate knows how to honour.
    if (!row || (row.role !== "ADMIN" && row.role !== "MANAGER")) return null;
    return { id: row.id, role: row.role };
  } catch (error) {
    logger.error(
      "Could not read the invitations — admitting nobody on one",
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

/** The switches for the Admin screen: a failed read is an error there, not a quiet default. */
export async function getSignUpSettings(): Promise<SignUpSettings> {
  const row = await getPrismaClient().instanceSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { googleSignUp: true, invitations: true },
  });
  return row ?? DEFAULT_SIGN_UP_SETTINGS;
}

/**
 * Change one or both switches. Each one that actually changes is audited with what it was and what
 * it is. Returns the settings as they now stand.
 *
 * Only the switches named in `patch` are written. Writing both from what was read a moment ago would
 * let two administrators changing different switches at once put back the one the other just closed.
 */
export async function updateSignUpSettings(
  actorId: string,
  patch: Partial<SignUpSettings>,
): Promise<SignUpSettings> {
  const prisma = getPrismaClient();
  const before = await getSignUpSettings();
  const changes: Partial<SignUpSettings> = {};
  if (patch.googleSignUp !== undefined) changes.googleSignUp = patch.googleSignUp;
  if (patch.invitations !== undefined) changes.invitations = patch.invitations;

  const stored = await prisma.instanceSettings.upsert({
    where: { id: SETTINGS_ID },
    update: { ...changes, updatedById: actorId },
    create: { id: SETTINGS_ID, ...before, ...changes, updatedById: actorId },
    select: { googleSignUp: true, invitations: true },
  });

  for (const setting of Object.keys(changes) as (keyof SignUpSettings)[]) {
    if (before[setting] === changes[setting]) continue;
    await logAudit({
      userId: actorId,
      action: "SIGN_UP_SETTING_CHANGE",
      resourceType: "instance_settings",
      resourceId: SETTINGS_ID,
      details: { setting, from: before[setting], to: changes[setting] },
    });
  }
  return stored;
}

const toSummary = (row: {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
}): InvitationSummary => ({
  id: row.id,
  email: row.email,
  role: row.role === "ADMIN" ? "ADMIN" : "MANAGER",
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  expired: row.expiresAt.getTime() <= Date.now(),
});

/** Every invitation still held, newest first, with the lapsed ones marked. */
export async function listInvitations(): Promise<InvitationSummary[]> {
  const rows = await getPrismaClient().accessInvitation.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
  });
  return rows.map(toSummary);
}

/**
 * Invite an email to create an account, as `role`. Inviting an email that already has an account is
 * refused, since there is nothing to admit; inviting one that is already invited renews it, with the
 * role and the thirty days of this invitation.
 */
export async function createInvitation(
  actorId: string,
  input: { email: string; role: InvitedRole },
): Promise<InvitationSummary> {
  const prisma = getPrismaClient();
  const email = normalizeEmail(input.email);

  const account = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (account) {
    throw new ConflictError("An account with this email already exists", "account_exists");
  }

  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  const existing = await prisma.accessInvitation.findUnique({
    where: { email },
    select: { id: true },
  });
  const row = await prisma.accessInvitation.upsert({
    where: { email },
    update: { role: input.role, invitedById: actorId, expiresAt },
    create: { email, role: input.role, invitedById: actorId, expiresAt },
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
  });

  await logAudit({
    userId: actorId,
    action: "CREATE_INVITATION",
    resourceType: "access_invitation",
    resourceId: row.id,
    details: { email: maskEmail(email), role: input.role, renewed: Boolean(existing) },
  });
  return toSummary(row);
}

/** Withdraw an invitation. One that is not there is a 404. */
export async function revokeInvitation(actorId: string, id: string): Promise<void> {
  const prisma = getPrismaClient();
  const row = await prisma.accessInvitation.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  if (!row) throw new ResourceNotFoundError("Invitation");

  const { count } = await prisma.accessInvitation.deleteMany({ where: { id: row.id } });
  // Gone between the read and the delete (it was used, or withdrawn): that is what was asked.
  if (count === 0) return;

  await logAudit({
    userId: actorId,
    action: "REVOKE_INVITATION",
    resourceType: "access_invitation",
    resourceId: row.id,
    details: { email: maskEmail(row.email), role: row.role },
  });
}
