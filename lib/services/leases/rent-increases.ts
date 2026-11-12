/**
 * Rent increases decided ahead of the month they start (`RentIncrease`).
 *
 * The rules a date should follow (a year after the start or the last update, 30 days' written
 * notice) live in `lib/utils/rent-increase.ts`, which the Leases screen shows as warnings: a
 * contract can carry its own update clause, so the server records what the owner decided rather
 * than refusing it. What it does refuse is what the ledger cannot honour: a start month that is no
 * longer ahead (change the rent on the lease instead), or a second pending increase on one lease.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { auditLeasePeriodSync, syncLeasePeriods } from "@/lib/services/allocation/service";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { increasedRent, monthStartUtc } from "@/lib/utils/rent-increase";

export interface ScheduleRentIncreaseInput {
  /** The first day of the month the new rent starts, UTC. */
  effectiveFrom: Date;
  percent: number;
  noticeDate?: Date | null;
}

/**
 * Record an increase on an active lease, and reprice its months from `effectiveFrom` on in the
 * same transaction. The new rent is the lease's current rent plus `percent`.
 */
export async function scheduleRentIncrease(
  userId: string,
  leaseId: string,
  input: ScheduleRentIncreaseInput,
  now: Date = new Date(),
) {
  const prisma = getPrismaClient();
  const effectiveFrom = monthStartUtc(input.effectiveFrom);

  const { increase, sync } = await prisma.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { id: leaseId, userId },
      select: { id: true, status: true, monthlyRent: true },
    });
    if (!lease) throw new ResourceNotFoundError("Lease");
    if (lease.status !== "active") {
      throw new ConflictError("Only an active lease can have its rent updated", "lease_not_active");
    }
    // The month's rent is due on its first day: a month that has started is already owed.
    if (effectiveFrom.getTime() <= now.getTime()) {
      throw new ConflictError(
        "The new rent has to start in a month still ahead",
        "rent_increase_not_ahead",
      );
    }
    const pending = await tx.rentIncrease.count({ where: { leaseId, appliedAt: null } });
    if (pending > 0) {
      throw new ConflictError(
        "This lease already has a rent increase waiting to start",
        "rent_increase_pending",
      );
    }

    const increase = await tx.rentIncrease.create({
      data: {
        userId,
        leaseId,
        effectiveFrom,
        previousRent: lease.monthlyRent,
        newRent: increasedRent(lease.monthlyRent, input.percent),
        percent: input.percent,
        noticeDate: input.noticeDate ?? null,
      },
    });
    const sync = await syncLeasePeriods(leaseId, tx, now);
    return { increase, sync };
  });

  await logAudit({
    userId,
    action: "UPDATE_LEASE",
    resourceType: "lease",
    resourceId: leaseId,
    details: {
      rentIncrease: "scheduled",
      effectiveFrom: increase.effectiveFrom.toISOString(),
      previousRent: increase.previousRent,
      newRent: increase.newRent,
      percent: increase.percent,
    },
  });
  await auditLeasePeriodSync(userId, leaseId, sync);
  return increase;
}

/** Withdraw an increase that has not started, and put its months back at the current rent. */
export async function cancelRentIncrease(
  userId: string,
  leaseId: string,
  increaseId: string,
  now: Date = new Date(),
): Promise<void> {
  const prisma = getPrismaClient();
  const sync = await prisma.$transaction(async (tx) => {
    const increase = await tx.rentIncrease.findFirst({
      where: { id: increaseId, leaseId, userId },
      select: { appliedAt: true },
    });
    if (!increase) throw new ResourceNotFoundError("Rent increase");
    if (increase.appliedAt) {
      throw new ConflictError(
        "This increase has taken effect; change the lease's rent instead",
        "rent_increase_applied",
      );
    }
    await tx.rentIncrease.delete({ where: { id: increaseId } });
    return syncLeasePeriods(leaseId, tx, now);
  });

  await logAudit({
    userId,
    action: "UPDATE_LEASE",
    resourceType: "lease",
    resourceId: leaseId,
    details: { rentIncrease: "cancelled", increaseId },
  });
  await auditLeasePeriodSync(userId, leaseId, sync);
}

/**
 * Write the rent of every increase whose month has arrived onto its lease. The months were owed
 * at the new rent already; this makes the lease, and every screen that reads its rent, agree.
 * Idempotent, and cheap when nothing is due. Scoped to one account when `userId` is given.
 */
export async function applyDueRentIncreases(
  userId?: string,
  now: Date = new Date(),
): Promise<number> {
  const prisma = getPrismaClient();
  const due = await prisma.rentIncrease.findMany({
    where: { appliedAt: null, effectiveFrom: { lte: now }, ...(userId ? { userId } : {}) },
    orderBy: { effectiveFrom: "asc" },
    select: { id: true, leaseId: true, newRent: true },
  });

  for (const increase of due) {
    await prisma.$transaction([
      prisma.lease.update({
        where: { id: increase.leaseId },
        data: { monthlyRent: increase.newRent },
      }),
      prisma.rentIncrease.update({
        where: { id: increase.id, appliedAt: null },
        data: { appliedAt: now },
      }),
    ]);
  }
  return due.length;
}
