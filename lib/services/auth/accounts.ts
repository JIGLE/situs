/**
 * The accounts on this instance, and who may be what.
 *
 * An administrator changes an account's role and nothing else about it: nothing is blocked or deleted
 * here by one. The roles one can be given are the two an invitation carries, administrator and
 * manager, never USER, which every owner route refuses. The instance must keep an administrator, so
 * the last one cannot be demoted, nor delete their own account while others remain.
 *
 * Every rule a change rests on is checked by the UPDATE that makes it, not by a read before it, since
 * another change can fall between a read and a write: two administrators demoting each other, or
 * themselves, at the same moment would each see the other still there and leave none; an
 * administrator demoted a moment ago would still finish what they had begun. The UPDATE goes through
 * only while, at the moment it runs, the account still has the role it was read with, the one asking
 * is still an administrator and, for an administrator being demoted, another one exists. A change
 * that finds the account changed meanwhile reads it again instead of overwriting it.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import type { InvitedRole } from "@/lib/services/auth/sign-up";
import { ConflictError, ForbiddenError, ResourceNotFoundError } from "@/lib/utils/error-handling";

export interface AccountSummary {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "MANAGER" | "USER";
  createdAt: string;
  /** The account asking, so the screen can mark it as the reader's own. */
  self: boolean;
}

const ACCOUNT_SELECT = { id: true, email: true, name: true, role: true, createdAt: true } as const;

type AccountRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
};

const toSummary = (row: AccountRow, callerId: string): AccountSummary => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role === "ADMIN" ? "ADMIN" : row.role === "MANAGER" ? "MANAGER" : "USER",
  createdAt: row.createdAt.toISOString(),
  self: row.id === callerId,
});

/** Every account, the oldest first. */
export async function listAccounts(callerId: string): Promise<AccountSummary[]> {
  const rows = await getPrismaClient().user.findMany({
    select: ACCOUNT_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => toSummary(row, callerId));
}

type Prisma = ReturnType<typeof getPrismaClient>;

/**
 * Why nothing was written. `forbidden`: the one asking is no administrator now (demoted, or gone),
 * which outranks every other reason. `last_admin`: an administrator would have been demoted with no
 * other left. `changed`: the account is gone or no longer has the role it was read with, which the
 * caller reads again.
 */
type Refusal = "forbidden" | "last_admin" | "changed";

/**
 * Give `id` the role `to`, in one statement that checks, as it writes, that the account still has the
 * role `from`, that `actorId` is still an administrator, and that an administrator being demoted
 * leaves another one. Returns null when it wrote, otherwise why it did not.
 */
async function write(
  prisma: Prisma,
  actorId: string,
  id: string,
  from: string,
  to: InvitedRole,
): Promise<Refusal | null> {
  const written = await prisma.$executeRaw`
    UPDATE "User"
    SET "role" = ${to}, "updatedAt" = strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'
    WHERE "id" = ${id}
      AND "role" = ${from}
      AND EXISTS (SELECT 1 FROM "User" WHERE "id" = ${actorId} AND "role" = 'ADMIN')
      AND ("role" <> 'ADMIN' OR (SELECT COUNT(*) FROM "User" WHERE "role" = 'ADMIN') > 1)`;
  if (written > 0) return null;

  const rows = await prisma.user.findMany({
    where: { id: { in: [actorId, id] } },
    select: { id: true, role: true },
  });
  const roleOf = (who: string) => rows.find((row) => row.id === who)?.role;
  if (roleOf(actorId) !== "ADMIN") return "forbidden";
  return from === "ADMIN" && roleOf(id) === "ADMIN" ? "last_admin" : "changed";
}

/**
 * Give an account a role. Changing it to the role it already has is no change: nothing is written and
 * nothing is audited. Demoting the only administrator is a 409 `last_admin`; a change by someone who
 * is no longer an administrator is a 403, whatever the session they started it with says.
 */
export async function changeAccountRole(
  actorId: string,
  targetId: string,
  role: InvitedRole,
): Promise<AccountSummary> {
  const prisma = getPrismaClient();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: ACCOUNT_SELECT,
    });
    if (!target) throw new ResourceNotFoundError("Account");
    if (target.role === role) return toSummary(target, actorId);

    const refusal = await write(prisma, actorId, target.id, target.role, role);

    if (refusal === "forbidden") throw new ForbiddenError("Forbidden: Admin access required");
    if (refusal === "last_admin") {
      throw new ConflictError("The instance needs an administrator", "last_admin");
    }
    if (refusal === null) {
      await logAudit({
        userId: actorId,
        action: "CHANGE_ACCOUNT_ROLE",
        resourceType: "user",
        resourceId: target.id,
        details: { from: target.role, to: role },
      });
      return toSummary({ ...target, role }, actorId);
    }
    // Someone changed this account between the read and the write: read it again.
  }

  throw new ConflictError("The account was changed by someone else; try again", "account_changed");
}

/**
 * Delete the account `id` and everything it owns: the holder's own right to erasure, through
 * `POST /api/user/delete-data`. The instance must keep an administrator, so the only one cannot go
 * while other accounts remain, since they would have nobody to administer them; the last account of
 * all can, which returns the instance to its first sign-in. As with a role change the rule is part of
 * the statement that makes it, not a count before it: two administrators deleting themselves at the
 * same moment would each see the other still there and leave none.
 */
export async function deleteOwnAccount(id: string): Promise<void> {
  const prisma = getPrismaClient();
  const deleted = await prisma.$executeRaw`
    DELETE FROM "User"
    WHERE "id" = ${id}
      AND ("role" <> 'ADMIN'
        OR (SELECT COUNT(*) FROM "User" WHERE "role" = 'ADMIN') > 1
        OR (SELECT COUNT(*) FROM "User") = 1)`;
  if (deleted > 0) return;

  const now = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!now) throw new ResourceNotFoundError("Account");
  if (now.role === "ADMIN") {
    throw new ConflictError("The instance needs an administrator", "last_admin");
  }
  // It was the only administrator when the statement ran and is not now: someone changed it meanwhile.
  throw new ConflictError("The account was changed by someone else; try again", "account_changed");
}
