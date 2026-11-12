/**
 * The rent a tenancy had before it reached Situs: a contract entered after it started (typed in, or
 * read from its Finanças proof) begins owing every month since its start, which the owner was paid
 * long ago. Two things settle that:
 *
 * - `settleRentBefore`: the months before the one the owner says Situs tracks from are marked
 *   `waived`, the ledger's one stored decision, so nothing chases them and the waterfall passes
 *   over them. A month with live money on it is left as it is.
 * - `rentSuggestions`: the bank movements already in, matched to nothing, that look like this
 *   tenancy's rent. The owner ticks them and each is confirmed through the inbox's own Confirm
 *   (`applyTransactionAction`), which allocates it and remembers the payer's account.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { buildLeaseCandidates } from "@/lib/services/bank/import";
import { isTestConnection } from "@/lib/services/bank/metadata";
import { scoreCandidate, type MatchReason } from "@/lib/services/matching/engine";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";
import { MONEY_EPSILON } from "@/lib/utils/money";

export interface RentSuggestion {
  transactionId: string;
  bookingDate: string;
  amount: number;
  counterpartyName: string | null;
  reference: string | null;
  reasons: MatchReason[];
  /** The amount and the payer (by name, account or reference) both point at this tenancy. */
  likely: boolean;
}

export interface OpenMonth {
  /** "2025-03". */
  month: string;
  outstanding: number;
}

export interface RentHistory {
  /** The lease's first month, "2025-02". */
  startMonth: string;
  suggestions: RentSuggestion[];
  /** Months up to now still owing something, oldest first: where confirmed payments will go. */
  openMonths: OpenMonth[];
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** A rent paid early, the days before its month, still belongs to the tenancy. */
const EARLY_DAYS = 10;

const AMOUNT_REASONS: MatchReason[] = ["amount_exact", "amount_multiple", "amount_remainder"];
const PAYER_REASONS: MatchReason[] = [
  "name_match",
  "iban_match",
  "learned_account",
  "reference_hit",
];

export async function rentHistory(
  userId: string,
  leaseId: string,
  now: Date = new Date(),
): Promise<RentHistory> {
  const prisma = getPrismaClient();
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, userId },
    select: { id: true, status: true, startDate: true },
  });
  if (!lease) throw new ResourceNotFoundError("Lease");
  if (lease.status !== "active") {
    throw new ConflictError("Only an active lease owes rent", "lease_not_active");
  }

  const start = new Date(lease.startDate);
  const startMonth = monthKey(start.getUTCFullYear(), start.getUTCMonth() + 1);

  const candidate = (await buildLeaseCandidates(userId)).find((c) => c.leaseId === leaseId);
  const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  from.setUTCDate(from.getUTCDate() - EARLY_DAYS);

  const movements = candidate
    ? await prisma.bankTransaction.findMany({
        where: {
          userId,
          amount: { gt: 0 },
          receiptId: null,
          status: { in: ["imported", "needs_review"] },
          bookingDate: { gte: from, lte: now },
        },
        orderBy: { bookingDate: "asc" },
        select: {
          id: true,
          amount: true,
          bookingDate: true,
          counterpartyName: true,
          counterpartyIbanHash: true,
          reference: true,
          bankAccount: { select: { connection: { select: { metadata: true } } } },
        },
      })
    : [];

  const suggestions: RentSuggestion[] = [];
  for (const txn of movements) {
    // Sandbox money is never a payment: the inbox refuses to confirm it, so it is not offered.
    if (isTestConnection(txn.bankAccount.connection.metadata)) continue;
    const { reasons } = scoreCandidate(txn, candidate!);
    const amount = reasons.some((r) => AMOUNT_REASONS.includes(r));
    if (!amount) continue;
    suggestions.push({
      transactionId: txn.id,
      bookingDate: txn.bookingDate.toISOString(),
      amount: txn.amount,
      counterpartyName: txn.counterpartyName,
      reference: txn.reference,
      reasons,
      likely: reasons.some((r) => PAYER_REASONS.includes(r)),
    });
  }

  const periods = await prisma.rentPeriod.findMany({
    where: { leaseId, status: { not: "waived" }, dueDate: { lte: now } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { year: true, month: true, dueAmount: true, allocatedAmount: true },
  });
  const openMonths = periods
    .filter((p) => p.allocatedAmount < p.dueAmount - MONEY_EPSILON)
    .map((p) => ({
      month: monthKey(p.year, p.month),
      outstanding: Math.round((p.dueAmount - p.allocatedAmount) * 100) / 100,
    }));

  return { startMonth, suggestions, openMonths };
}

/**
 * Mark the lease's months before `from` (a month's first day, UTC) as settled before Situs. Only a
 * month with no live allocation is touched, so money already on the ledger stays where it is.
 * Returns how many months were marked.
 */
export async function settleRentBefore(
  userId: string,
  leaseId: string,
  from: Date,
): Promise<number> {
  const prisma = getPrismaClient();
  const cutoff = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1);

  const settled = await prisma.$transaction(async (tx) => {
    const lease = await tx.lease.findFirst({
      where: { id: leaseId, userId },
      select: { id: true, status: true },
    });
    if (!lease) throw new ResourceNotFoundError("Lease");
    if (lease.status !== "active") {
      throw new ConflictError("Only an active lease owes rent", "lease_not_active");
    }
    const periods = await tx.rentPeriod.findMany({
      where: { leaseId, status: { not: "waived" } },
      select: {
        id: true,
        year: true,
        month: true,
        allocations: { where: { reversedAt: null }, select: { id: true } },
      },
    });
    const ids = periods
      .filter((p) => Date.UTC(p.year, p.month - 1, 1) < cutoff && p.allocations.length === 0)
      .map((p) => p.id);
    if (ids.length === 0) return 0;
    await tx.rentPeriod.updateMany({ where: { id: { in: ids } }, data: { status: "waived" } });
    return ids.length;
  });

  if (settled > 0) {
    await logAudit({
      userId,
      action: "SETTLE_RENT_BEFORE",
      resourceType: "lease",
      resourceId: leaseId,
      details: { from: new Date(cutoff).toISOString().slice(0, 7), months: settled },
    });
  }
  return settled;
}
