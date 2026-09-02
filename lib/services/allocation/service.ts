/**
 * Situs allocation service — Prisma orchestration around the pure engine.
 *
 * Responsibilities the engine deliberately does NOT have:
 *  - generating a lease's rent periods (idempotent upserts)
 *  - idempotency for a payment source (skip if live allocations exist)
 *  - applying a plan transactionally: allocation rows, period totals/statuses,
 *    receipt back-links, derived tenant status, audit entry
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";

import { derivePeriodStatus, deriveTenantStatus, periodDueDate, planAllocation } from "./engine";
import type { AllocationPlan, PeriodSnapshot, RentPeriodStatus } from "./types";

const HORIZON_MONTHS = 12;

/**
 * The client handed to a `$transaction` callback: a PrismaClient minus the methods that
 * cannot be called inside a transaction. Derived from the callback's own parameter so it
 * tracks the Prisma version rather than being hand-maintained.
 */
type PrismaTransactionClient = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

/**
 * Ensure a lease has RentPeriod rows from its start date through
 * min(endDate, now + horizon). Idempotent — existing periods are left alone
 * (their dueAmount snapshot must survive rent adjustments).
 */
export async function generateRentPeriods(leaseId: string): Promise<number> {
  const prisma = getPrismaClient();
  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease) return 0;

  const start = new Date(lease.startDate);
  const horizon = new Date();
  horizon.setUTCMonth(horizon.getUTCMonth() + HORIZON_MONTHS);
  const end = new Date(Math.min(new Date(lease.endDate).getTime(), horizon.getTime()));

  const wanted: { year: number; month: number }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    wanted.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  if (wanted.length === 0) return 0;

  const existing = await prisma.rentPeriod.findMany({
    where: { leaseId },
    select: { year: true, month: true },
  });
  const have = new Set(existing.map((p) => `${p.year}-${p.month}`));
  const missing = wanted.filter((p) => !have.has(`${p.year}-${p.month}`));
  if (missing.length === 0) return 0;

  const now = new Date();
  await prisma.rentPeriod.createMany({
    data: missing.map((p) => {
      const dueDate = periodDueDate(p);
      return {
        userId: lease.userId,
        leaseId,
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        year: p.year,
        month: p.month,
        dueDate,
        dueAmount: lease.monthlyRent,
        allocatedAmount: 0,
        status: derivePeriodStatus(
          { dueDate, dueAmount: lease.monthlyRent, allocatedAmount: 0 },
          now,
        ),
        updatedAt: now,
      };
    }),
  });

  await logAudit({
    userId: lease.userId,
    action: "GENERATE_RENT_PERIODS",
    resourceType: "lease",
    resourceId: leaseId,
    details: { created: missing.length },
  });

  return missing.length;
}

/**
 * Allocate a rent Receipt to reference months via the waterfall. Idempotent:
 * a receipt with live (non-reversed) allocations is skipped. Returns the plan
 * that was applied, or null when skipped/not applicable.
 */
export async function allocateReceipt(receiptId: string): Promise<AllocationPlan | null> {
  const prisma = getPrismaClient();

  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt || receipt.type !== "rent") return null;

  const existing = await prisma.paymentAllocation.count({
    where: { receiptId, reversedAt: null },
  });
  if (existing > 0) return null; // idempotency

  // Resolve the lease: explicit link first, else the tenant's single lease.
  let leaseId = receipt.leaseId;
  if (!leaseId) {
    const leases = await prisma.lease.findMany({
      where: { tenantId: receipt.tenantId, status: "active" },
      select: { id: true },
      take: 2,
    });
    if (leases.length !== 1) return null; // ambiguous or none — needs review, not guesswork
    leaseId = leases[0].id;
  }

  await generateRentPeriods(leaseId);

  const periods = await prisma.rentPeriod.findMany({ where: { leaseId } });
  const snapshots: PeriodSnapshot[] = periods.map((p) => ({
    id: p.id,
    year: p.year,
    month: p.month,
    dueAmount: p.dueAmount,
    allocatedAmount: p.allocatedAmount,
  }));

  const plan = planAllocation({
    payment: { id: receipt.id, amount: receipt.amount, bookingDate: receipt.date },
    periods: snapshots,
    horizonMonths: HORIZON_MONTHS,
  });
  if (plan.entries.length === 0) return plan;

  const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // The row id the receipt is back-linked to, captured as the first entry resolves. It cannot be
    // read off `plan.entries[0].period` afterwards: an engine-created future period carries no `id`
    // until the loop below inserts it, so a receipt whose first entry is one of those — a tenant
    // paying a month ahead, where no existing period is short — would take `undefined` and leave
    // `Receipt.rentPeriodId` null while `referenceMonth` was set. Nothing downstream complains,
    // which is why it survived: the ledger rows are all correct, only the receipt's own pointer
    // back into them is missing.
    let primaryPeriodId: string | undefined;

    for (const entry of plan.entries) {
      // Engine-created future periods materialize here.
      let periodId = entry.period.id;
      let periodRow;
      if (!periodId) {
        periodRow = await tx.rentPeriod.create({
          data: {
            userId: lease.userId,
            leaseId,
            tenantId: lease.tenantId,
            propertyId: lease.propertyId,
            year: entry.period.year,
            month: entry.period.month,
            dueDate: periodDueDate(entry.period),
            dueAmount: lease.monthlyRent,
            allocatedAmount: 0,
            status: "upcoming",
            updatedAt: now,
          },
        });
        periodId = periodRow.id;
      } else {
        periodRow = await tx.rentPeriod.findUniqueOrThrow({ where: { id: periodId } });
      }
      primaryPeriodId ??= periodId;

      await tx.paymentAllocation.create({
        data: {
          userId: lease.userId,
          rentPeriodId: periodId,
          receiptId: receipt.id,
          amount: entry.amount,
          type: entry.type,
          allocatedAt: receipt.date,
          createdBy: "system",
        },
      });

      const allocatedAmount = periodRow.allocatedAmount + entry.amount;
      const fullyPaid = allocatedAmount >= periodRow.dueAmount - 0.005;
      await tx.rentPeriod.update({
        where: { id: periodId },
        data: {
          allocatedAmount,
          paidAt: fullyPaid ? receipt.date : null,
          status: derivePeriodStatus(
            {
              dueDate: periodRow.dueDate,
              dueAmount: periodRow.dueAmount,
              allocatedAmount,
              fullyPaidAt: fullyPaid ? receipt.date : null,
            },
            now,
          ),
        },
      });
    }

    // Back-link the receipt to its primary reference month.
    const primary = plan.entries[0].period;
    await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        leaseId,
        rentPeriodId: primaryPeriodId,
        referenceMonth: `${primary.year}-${String(primary.month).padStart(2, "0")}`,
      },
    });

    // Tenant.paymentStatus becomes DERIVED from the ledger.
    const statuses = await tx.rentPeriod.findMany({
      where: { tenantId: lease.tenantId },
      select: { status: true },
    });
    await tx.tenant.update({
      where: { id: lease.tenantId },
      data: {
        paymentStatus: deriveTenantStatus(statuses.map((s) => s.status as RentPeriodStatus)),
        lastPayment: receipt.date,
      },
    });
  });

  await logAudit({
    userId: lease.userId,
    action: "ALLOCATE_PAYMENT",
    resourceType: "receipt",
    resourceId: receipt.id,
    details: {
      leaseId,
      entries: plan.entries.map((e) => ({
        period: `${e.period.year}-${e.period.month}`,
        amount: e.amount,
        type: e.type,
      })),
      warnings: plan.warnings,
    },
  });

  return plan;
}

/**
 * Soft-reverse every live allocation for a receipt (e.g. the receipt is
 * voided): marks allocations reversed, regresses the affected periods'
 * allocated totals + statuses, and recomputes tenant status. History
 * survives — rows are never deleted.
 */
export async function reverseAllocationsForReceipt(
  receiptId: string,
  reason: string,
  /**
   * Join an existing transaction instead of opening one.
   *
   * The receipt lifecycle needs the reversal and the `receipt.lifecycle` write to succeed or
   * fail together: without this, a failure between them left allocations reversed while the
   * receipt still read "emitted" — the rent period says unpaid and the receipt disagrees.
   * Prisma cannot nest `$transaction`, so the caller passes its `tx` down rather than
   * wrapping a function that opens its own.
   */
  existingTx?: PrismaTransactionClient,
): Promise<number> {
  const prisma = getPrismaClient();
  const allocations = await prisma.paymentAllocation.findMany({
    where: { receiptId, reversedAt: null },
  });
  if (allocations.length === 0) return 0;

  const now = new Date();
  const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });

  const applyReversal = async (tx: PrismaTransactionClient) => {
    for (const allocation of allocations) {
      await tx.paymentAllocation.update({
        where: { id: allocation.id },
        data: { reversedAt: now, reversalReason: reason },
      });

      const period = await tx.rentPeriod.findUniqueOrThrow({
        where: { id: allocation.rentPeriodId },
      });
      const allocatedAmount = Math.max(0, period.allocatedAmount - allocation.amount);
      const fullyPaid = allocatedAmount >= period.dueAmount - 0.005;
      await tx.rentPeriod.update({
        where: { id: period.id },
        data: {
          allocatedAmount,
          paidAt: fullyPaid ? period.paidAt : null,
          status: derivePeriodStatus(
            {
              dueDate: period.dueDate,
              dueAmount: period.dueAmount,
              allocatedAmount,
              fullyPaidAt: fullyPaid ? period.paidAt : null,
            },
            now,
          ),
        },
      });
    }

    const statuses = await tx.rentPeriod.findMany({
      where: { tenantId: receipt.tenantId },
      select: { status: true },
    });
    await tx.tenant.update({
      where: { id: receipt.tenantId },
      data: {
        paymentStatus: deriveTenantStatus(statuses.map((s) => s.status as RentPeriodStatus)),
      },
    });
  };

  if (existingTx) {
    await applyReversal(existingTx);
  } else {
    await prisma.$transaction(applyReversal);
  }

  // Deliberately outside the transaction. An audit write failing should not roll back a
  // correct financial reversal — the money state is the thing that must not be left
  // half-applied. A missing audit row is recoverable; a half-reversed ledger is not.
  await logAudit({
    userId: receipt.userId,
    action: "REVERSE_ALLOCATION",
    resourceType: "receipt",
    resourceId: receiptId,
    details: { reason, count: allocations.length },
  });

  return allocations.length;
}

/** Recompute a tenant's derived payment status outside an allocation flow. */
export async function recomputeTenantStatus(tenantId: string): Promise<void> {
  const prisma = getPrismaClient();
  const statuses = await prisma.rentPeriod.findMany({
    where: { tenantId },
    select: { status: true },
  });
  if (statuses.length === 0) return; // no ledger yet — leave the manual value alone
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { paymentStatus: deriveTenantStatus(statuses.map((s) => s.status as RentPeriodStatus)) },
  });
}
