/**
 * Recibos de renda uploaded from the Portal das Finanças, put on the rent ledger.
 *
 * A recibo says which contract's month was paid, how much and when. Uploading one does one of
 * three things to that month:
 *  - **create**: nothing paid it yet, so the recibo is the payment: a paid, emitted receipt that
 *    fills that month first (`referenceMonth`, the engine's `startAt`), not the oldest open one.
 *  - **attach**: a payment is already on the month (a bank movement or one recorded by hand), so
 *    no money is added: those receipts take the recibo's number, and a draft from the bank is
 *    marked emitted, which is what issuing the recibo on the Portal means.
 *  - **duplicate**: this recibo number is already on the contract, so nothing changes.
 *
 * Either way the uploaded PDF becomes the receipt's archive (`findExistingArchive`), so the
 * Receipts list serves the recibo itself. `Receipt.financasNumber` set is what the matrix shows
 * as "recibo on file", the darker of its two greens.
 *
 * A month the owner waived (before they started tracking) comes back on the ledger when a recibo
 * for it is uploaded: it says that month was paid, and the rent it states is what that month owed
 * (the waived row only copied today's rent).
 *
 * - **extend**: an active contract has no month for it, because the recibo is older than the
 *   contract's start in Situs (often typed as its latest renewal) or later than its end.
 *   - After the end: an active contract renews on its own until the owner ends it (art. 1096 CC),
 *     so the month is in force. The end is carried forward a year at a time, with no question.
 *   - Before the start: a recibo never moves a contract's start on its own. Without the owner's
 *     tick on its line (`allowTermChange`) the month is refused; with it, the start moves back.
 *   The months a new start adds before the old one were never tracked, so they are waived like
 *   the months before "Track rent from" (`settleRentBefore`); a later recibo for one brings it back.
 *   Then the recibo pays its month as in **create**.
 *
 * A contract that is not active has nothing generated, so a month it has no row for is refused.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { partiesByLease } from "@/lib/services/database/lease-parties";
import {
  allocateReceipt,
  auditLeasePeriodSync,
  syncLeasePeriods,
} from "@/lib/services/allocation/service";
import { logAudit } from "@/lib/services/audit-log";
import { documentService } from "@/lib/services/document-service";
import { removeDocuments } from "@/lib/services/document-service";
import { receiptService } from "@/lib/services/database/receipt/service";
import {
  ARCHIVE_MARKER_PREFIX,
  findExistingArchive,
  transitionReceipt,
} from "@/lib/services/receipts/service";
import type { ParsedRentReceipt } from "@/lib/services/financas-import/rent-receipt";
import {
  leasesForReceipt,
  receiptMonth,
  type ReceiptMatchLease,
  type ReceiptMonth,
} from "@/lib/services/financas-import/receipt-match";
import { readablePII } from "@/lib/utils/pii-encryption";
import { MONEY_EPSILON } from "@/lib/utils/money";
import { ConflictError, ResourceNotFoundError } from "@/lib/utils/error-handling";

/**
 * `paid`: the month is already paid by money with no receipt to take the recibo's number, so
 * nothing changes. A recibo never adds money to a month that owes nothing: the engine would carry
 * it to another month the recibo does not name.
 */
export type ReceiptUploadOutcome =
  "create" | "extend" | "attach" | "duplicate" | "paid" | "no_month";

/** The contract's new term, when the recibo's month lies outside it ("YYYY-MM-DD"). */
export interface TermChange {
  startDate: string | null;
  endDate: string | null;
}

export interface ReceiptLeaseOption {
  leaseId: string;
  tenantName: string;
  propertyName: string;
  monthlyRent: number;
}

export interface ReceiptProposal {
  /** The contract it pays, when only one fits. */
  leaseId: string | null;
  /** The contracts it may pay, best first; empty when no tenant's NIF on it is known. */
  candidates: ReceiptLeaseOption[];
  month: ReceiptMonth | null;
  /** What uploading it would do, for the proposed contract and month. */
  outcome: ReceiptUploadOutcome | null;
  /** The month's rent, when it differs from the recibo's. */
  dueAmount: number | null;
  /** `extend`: how the contract's term moves to take the month. */
  term: TermChange | null;
  /** `no_month`: the contract is not active, so it owes no rent at all. */
  inactive: boolean;
  /** The proposed contract's term in Situs ("YYYY-MM-DD"), to set beside the recibo's month. */
  leaseStart: string | null;
  leaseEnd: string | null;
}

interface LeaseRow extends ReceiptMatchLease {
  option: ReceiptLeaseOption;
}

const monthKey = ({ year, month }: ReceiptMonth) => `${year}-${String(month).padStart(2, "0")}`;

/** The owner's leases (drafts aside), with every tenant's NIF read through its own model. */
async function matchableLeases(userId: string): Promise<LeaseRow[]> {
  const prisma = getPrismaClient();
  const leases = await prisma.lease.findMany({
    where: { userId, status: { not: "draft" } },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      monthlyRent: true,
      tenantId: true,
      propertyId: true,
    },
  });
  if (leases.length === 0) return [];
  const [tenants, properties, parties] = await Promise.all([
    prisma.tenant.findMany({
      where: { userId, id: { in: [...new Set(leases.map((l) => l.tenantId))] } },
      select: { id: true, name: true, taxId: true },
    }),
    prisma.property.findMany({
      where: { userId, id: { in: [...new Set(leases.map((l) => l.propertyId))] } },
      select: { id: true, name: true, cadasterReference: true, fraction: true },
    }),
    partiesByLease(
      userId,
      leases.map((l) => l.id),
    ),
  ]);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  return leases.flatMap((lease) => {
    const tenant = tenantById.get(lease.tenantId);
    const property = propertyById.get(lease.propertyId);
    if (!tenant || !property) return [];
    const coTenants = (parties.get(lease.id) ?? []).filter((p) => p.role === "tenant");
    const tenantTaxIds = [readablePII(tenant.taxId), ...coTenants.map((p) => p.taxId ?? null)]
      .map((taxId) => readablePII(taxId))
      .filter((taxId): taxId is string => Boolean(taxId));
    return [
      {
        id: lease.id,
        status: lease.status,
        startDate: lease.startDate.toISOString(),
        endDate: lease.endDate.toISOString(),
        tenantTaxIds,
        article: property.cadasterReference,
        fraction: property.fraction,
        option: {
          leaseId: lease.id,
          tenantName: tenant.name,
          propertyName: property.name,
          monthlyRent: lease.monthlyRent,
        },
      },
    ];
  });
}

interface MonthState {
  outcome: ReceiptUploadOutcome;
  periodId: string | null;
  dueAmount: number | null;
  waived: boolean;
  /** The receipts already paying the month that have no recibo yet. */
  unnumbered: { id: string; lifecycle: string }[];
  term?: TermChange;
  inactive?: boolean;
  /** `duplicate`: the receipt that already carries this recibo's number. */
  sameReceiptId?: string;
}

interface TermLease {
  id: string;
  status: string;
  startDate: Date;
  endDate: Date;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * How an active contract's term moves to take a month outside it: the start back to that month's
 * first day, or the end forward a year at a time until it reaches the month's last day. Null when
 * the month is inside the term.
 */
export function termToCover(
  lease: Pick<TermLease, "startDate" | "endDate">,
  month: ReceiptMonth,
): TermChange | null {
  const first = Date.UTC(month.year, month.month - 1, 1);
  const start = lease.startDate;
  const startMonth = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
  if (first < startMonth) {
    return { startDate: isoDay(new Date(first)), endDate: null };
  }
  const end = lease.endDate;
  // A month's rent is due on its first day, so a term ending inside the month already owes it.
  if (first <= end.getTime()) return null;
  const day = end.getUTCDate();
  for (let year = end.getUTCFullYear() + 1; year <= month.year + 1; year++) {
    const lastOfMonth = new Date(Date.UTC(year, end.getUTCMonth() + 1, 0)).getUTCDate();
    const next = Date.UTC(year, end.getUTCMonth(), Math.min(day, lastOfMonth));
    if (next >= first) return { startDate: null, endDate: isoDay(new Date(next)) };
  }
  return null;
}

/** What a recibo would do to one lease's month. */
async function monthState(
  userId: string,
  lease: TermLease,
  month: ReceiptMonth,
  number: string | null,
): Promise<MonthState> {
  const prisma = getPrismaClient();
  const leaseId = lease.id;
  if (number) {
    const same = await prisma.receipt.findFirst({
      where: { userId, leaseId, financasNumber: number, lifecycle: { not: "voided" } },
      select: { id: true },
    });
    if (same) {
      return {
        outcome: "duplicate",
        periodId: null,
        dueAmount: null,
        waived: false,
        unnumbered: [],
        sameReceiptId: same.id,
      };
    }
  }
  const period = await prisma.rentPeriod.findFirst({
    where: { userId, leaseId, year: month.year, month: month.month },
    select: { id: true, status: true, dueAmount: true, allocatedAmount: true },
  });
  if (!period) {
    const none = { periodId: null, dueAmount: null, waived: false, unnumbered: [] };
    if (lease.status !== "active") return { ...none, outcome: "no_month", inactive: true };
    const term = termToCover(lease, month);
    return term ? { ...none, outcome: "extend", term } : { ...none, outcome: "no_month" };
  }
  const allocations = await prisma.paymentAllocation.findMany({
    where: { userId, rentPeriodId: period.id, reversedAt: null },
    select: { receipt: { select: { id: true, lifecycle: true, financasNumber: true } } },
  });
  const paying = allocations.flatMap((a) =>
    a.receipt && a.receipt.lifecycle !== "voided" ? [a.receipt] : [],
  );
  const base = {
    periodId: period.id,
    dueAmount: period.dueAmount,
    waived: period.status === "waived",
  };
  if (paying.length === 0) {
    const settled = period.allocatedAmount >= period.dueAmount - MONEY_EPSILON;
    return { ...base, outcome: settled && !base.waived ? "paid" : "create", unnumbered: [] };
  }
  const unnumbered = [
    ...new Map(paying.filter((r) => !r.financasNumber).map((r) => [r.id, r])).values(),
  ].map(({ id, lifecycle }) => ({ id, lifecycle }));
  // Paid, and every payment already has its recibo: this one is another copy of it.
  if (unnumbered.length === 0) return { ...base, outcome: "duplicate", unnumbered };
  return { ...base, outcome: "attach", unnumbered };
}

/** Which contract and month an uploaded recibo pays, and what uploading it would do. */
export async function proposeReceipt(
  userId: string,
  parsed: ParsedRentReceipt,
): Promise<ReceiptProposal> {
  const leases = await matchableLeases(userId);
  const found = leasesForReceipt(parsed, leases);
  const month = receiptMonth(parsed);
  const leaseId = found.length === 1 ? found[0].id : null;
  const lease = leaseId ? found[0] : null;
  const state =
    lease && month
      ? await monthState(
          userId,
          {
            id: lease.id,
            status: lease.status,
            startDate: new Date(lease.startDate),
            endDate: new Date(lease.endDate),
          },
          month,
          parsed.number,
        )
      : null;
  // A waived month takes the recibo's rent, so only a tracked month's rent can differ from it.
  const due = state && !state.waived ? state.dueAmount : null;
  return {
    leaseId,
    candidates: found.map((option) => option.option),
    month,
    outcome: state?.outcome ?? null,
    dueAmount:
      due !== null && parsed.rent !== null && Math.abs(due - parsed.rent) > MONEY_EPSILON
        ? due
        : null,
    term: state?.term ?? null,
    inactive: state?.inactive ?? false,
    leaseStart: lease ? lease.startDate.slice(0, 10) : null,
    leaseEnd: lease ? lease.endDate.slice(0, 10) : null,
  };
}

export interface RegisterReceiptInput {
  leaseId: string;
  month: ReceiptMonth;
  parsed: ParsedRentReceipt;
  /** The recibo itself, kept as the receipt's archive. */
  pdf: Buffer;
  fileName: string;
  /**
   * The owner ticked "move the contract's dates" on this recibo's line. Without it, a month
   * outside the contract's term is refused, as before.
   */
  allowTermChange?: boolean;
}

export interface RegisterReceiptResult {
  outcome: Exclude<ReceiptUploadOutcome, "no_month" | "extend">;
  receiptIds: string[];
}

/** Put an uploaded recibo on the ledger, for the contract and month the owner confirmed. */
export async function registerReceipt(
  userId: string,
  input: RegisterReceiptInput,
  now: Date = new Date(),
): Promise<RegisterReceiptResult> {
  const prisma = getPrismaClient();
  const lease = await prisma.lease.findFirst({
    where: { id: input.leaseId, userId },
    select: {
      id: true,
      tenantId: true,
      propertyId: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!lease) throw new ResourceNotFoundError("Lease");

  const { parsed, month } = input;
  let state = await monthState(userId, lease, month, parsed.number);
  if (state.outcome === "no_month") {
    throw new ConflictError("The contract has no rent for that month", "receipt_month_untracked");
  }
  const archive = (receiptId: string) =>
    documentService.create(userId, {
      name: input.fileName.slice(0, 200) || `Recibo ${monthKey(month)}`,
      description: `${ARCHIVE_MARKER_PREFIX}${receiptId}`,
      type: "receipt",
      mimeType: "application/pdf",
      fileContent: input.pdf,
      propertyId: lease.propertyId,
      tenantId: lease.tenantId,
    });

  if (state.outcome === "duplicate" || state.outcome === "paid") {
    // The recibo is on file but its PDF is not: an earlier upload stopped after the payment was
    // written (the storage it files PDFs in could not be written). Uploading it again files it.
    if (state.sameReceiptId && !(await findExistingArchive(userId, state.sameReceiptId))) {
      await archive(state.sameReceiptId);
    }
    return { outcome: state.outcome, receiptIds: [] };
  }

  if (state.outcome === "attach") {
    const [first] = state.unnumbered;
    // The recibo is stored before the receipt is marked emitted, so the lifecycle finds it as the
    // archive and does not write a generated PDF of its own.
    await archive(first.id);
    for (const receipt of state.unnumbered) {
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: { financasNumber: parsed.number ?? "" },
      });
      if (receipt.lifecycle === "draft" || receipt.lifecycle === "review") {
        await transitionReceipt(userId, receipt.id, "emitted");
      }
    }
    await logAudit({
      userId,
      action: "UPLOAD_FINANCAS_RECEIPT",
      resourceType: "lease",
      resourceId: lease.id,
      details: {
        outcome: "attach",
        month: monthKey(month),
        number: parsed.number,
        receiptIds: state.unnumbered.map((r) => r.id),
        // What removing the recibo puts back: a bank draft it marked emitted returns to its stage.
        lifecycles: Object.fromEntries(state.unnumbered.map((r) => [r.id, r.lifecycle])),
      },
    });
    return { outcome: "attach", receiptIds: state.unnumbered.map((r) => r.id) };
  }

  const amount = parsed.rent ?? parsed.received;
  if (!amount || amount <= MONEY_EPSILON) {
    throw new ConflictError("The recibo's amount could not be read", "receipt_amount_unknown");
  }
  // A month the term was moved to take was never tracked either.
  let untracked = false;
  // An active contract renews on its own until the owner ends it, so a month after its stored end
  // is still in force: the end is carried forward with no question. Only a month before its start
  // waits for the owner's tick.
  if (state.outcome === "extend" && state.term?.startDate && !input.allowTermChange) {
    throw new ConflictError("The month is outside the contract's term", "receipt_month_untracked");
  }
  if (state.outcome === "extend" && state.term) {
    untracked = true;
    await extendTerm(userId, lease, state.term, month, now);
    state = await monthState(
      userId,
      { ...lease, ...termDates(lease, state.term) },
      month,
      parsed.number,
    );
    if (state.outcome !== "create" || !state.periodId) {
      throw new ConflictError("The contract has no rent for that month", "receipt_month_untracked");
    }
  }
  // A month waived when tracking began is owed again: the recibo says it was paid, and the rent it
  // states is what the month owed (an untracked month only copied today's rent). Allocation writes
  // its status afresh from what it owes and what fills it.
  const wasWaived = state.waived || untracked;
  if (wasWaived && state.periodId) {
    await prisma.rentPeriod.update({
      where: { id: state.periodId },
      data: { status: "upcoming", dueAmount: amount },
    });
  }
  const date = parsed.receivedOn ?? parsed.issuedOn ?? now.toISOString().slice(0, 10);
  const receipt = await prisma.receipt.create({
    data: {
      userId,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      leaseId: lease.id,
      amount,
      date: new Date(`${date}T00:00:00.000Z`),
      type: "rent",
      status: "paid",
      lifecycle: "emitted",
      // The recibo is the payment: removing it removes the receipt (`removeRecibo`).
      source: FINANCAS_SOURCE,
      referenceMonth: monthKey(month),
      financasNumber: parsed.number ?? "",
      description: parsed.number ? `Recibo de renda n.º ${parsed.number}` : "Recibo de renda",
    },
    select: { id: true },
  });
  await allocateReceipt(receipt.id);
  try {
    await archive(receipt.id);
  } catch (error) {
    // Without its PDF the upload did not happen: take the payment back off the month, so a retry
    // starts clean rather than finding a recibo "already on file" with nothing to show for it.
    await receiptService.delete(userId, receipt.id);
    if (wasWaived && state.periodId) await rewaive(state.periodId);
    throw error;
  }
  await logAudit({
    userId,
    action: "UPLOAD_FINANCAS_RECEIPT",
    resourceType: "receipt",
    resourceId: receipt.id,
    details: {
      outcome: "create",
      leaseId: lease.id,
      month: monthKey(month),
      number: parsed.number,
      // The month was waived (before tracking began): removing the recibo waives it again.
      wasWaived,
    },
  });
  return { outcome: "create", receiptIds: [receipt.id] };
}

/** `Receipt.source` of a receipt an uploaded recibo created: the recibo is the payment. */
export const FINANCAS_SOURCE = "financas";

/** Waive a month again once nothing pays it, as it was before a recibo brought it back. */
async function rewaive(periodId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const live = await prisma.paymentAllocation.count({
    where: { rentPeriodId: periodId, reversedAt: null },
  });
  if (live > 0) return false;
  await prisma.rentPeriod.update({ where: { id: periodId }, data: { status: "waived" } });
  return true;
}

export interface RemoveReciboResult {
  /** Receipts the recibo created, deleted with the money they put on the month. */
  deleted: string[];
  /** Payments that were there before it, which lose only its number. */
  detached: string[];
}

/**
 * Take an uploaded recibo back off the ledger: undo what `registerReceipt` did, and nothing else.
 *
 * The recibo is named by any receipt that carries its number; every receipt on the same contract
 * with that number is part of the same upload.
 *  - A receipt the recibo **created** (`source` financas, or an older one whose upload the audit
 *    trail records as `create`) is deleted, which reverses the money it put on the month. A month
 *    that was waived before the recibo brought it back is waived again.
 *  - A payment that was **already there** (a bank movement, one recorded by hand), or one a bank
 *    movement was linked to since, stays, with its money: it loses the recibo's number, and a bank draft the upload marked emitted goes back to
 *    the stage it had.
 * The PDFs filed as their archives go too. A contract's dates a recibo moved stay: an active
 * contract renews on its own, so the later end is right whatever the recibo was.
 *
 * Refused for a receipt filed with AT (submitted, accepted), as any delete of one is.
 */
export async function removeRecibo(userId: string, receiptId: string): Promise<RemoveReciboResult> {
  const prisma = getPrismaClient();
  const named = await prisma.receipt.findFirst({
    where: { id: receiptId, userId },
    select: { id: true, leaseId: true, financasNumber: true },
  });
  if (!named) throw new ResourceNotFoundError("Receipt");
  if (named.financasNumber == null) {
    throw new ConflictError("The receipt has no recibo from Finanças", "receipt_no_recibo");
  }
  const receipts = named.financasNumber
    ? await prisma.receipt.findMany({
        where: {
          userId,
          leaseId: named.leaseId,
          financasNumber: named.financasNumber,
          lifecycle: { not: "voided" },
        },
        select: { id: true, source: true, lifecycle: true, rentPeriodId: true },
      })
    : await prisma.receipt.findMany({
        where: { id: named.id, userId },
        select: { id: true, source: true, lifecycle: true, rentPeriodId: true },
      });
  if (receipts.some((r) => r.lifecycle === "submitted" || r.lifecycle === "accepted")) {
    throw new ConflictError("A receipt filed with AT is not removed", "receipt_filed");
  }

  const ids = receipts.map((r) => r.id);
  const uploads = await prisma.auditLog.findMany({
    where: { userId, action: "UPLOAD_FINANCAS_RECEIPT" },
    select: { resourceType: true, resourceId: true, details: true },
    orderBy: { createdAt: "desc" },
  });
  const created = new Map<string, { wasWaived: boolean }>();
  const lifecycles = new Map<string, string>();
  for (const row of uploads) {
    let details: Record<string, unknown> = {};
    try {
      details = row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {};
    } catch {
      continue;
    }
    if (row.resourceType === "receipt" && row.resourceId && details.outcome === "create") {
      if (!created.has(row.resourceId)) {
        created.set(row.resourceId, { wasWaived: details.wasWaived === true });
      }
    }
    if (
      details.outcome === "attach" &&
      details.lifecycles &&
      typeof details.lifecycles === "object"
    ) {
      for (const [id, stage] of Object.entries(details.lifecycles as Record<string, unknown>)) {
        if (typeof stage === "string" && !lifecycles.has(id)) lifecycles.set(id, stage);
      }
    }
  }

  const archives = await prisma.document.findMany({
    where: {
      userId,
      type: "receipt",
      description: { in: ids.map((id) => `${ARCHIVE_MARKER_PREFIX}${id}`) },
    },
    select: { id: true },
  });

  const result: RemoveReciboResult = { deleted: [], detached: [] };
  for (const receipt of receipts) {
    const madeByRecibo = receipt.source === FINANCAS_SOURCE || created.has(receipt.id);
    // A movement linked to it since is the money arriving: the payment stays, as one already
    // there would.
    const banked = await prisma.bankTransaction.count({ where: { userId, receiptId: receipt.id } });
    if (madeByRecibo && banked === 0) {
      const periods = await prisma.paymentAllocation.findMany({
        where: { receiptId: receipt.id, reversedAt: null },
        select: { rentPeriodId: true },
      });
      await receiptService.delete(userId, receipt.id);
      if (created.get(receipt.id)?.wasWaived) {
        for (const periodId of new Set(periods.map((p) => p.rentPeriodId))) {
          await rewaive(periodId);
        }
      }
      result.deleted.push(receipt.id);
    } else {
      const before = lifecycles.get(receipt.id);
      await prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          financasNumber: null,
          ...(before === "draft" || before === "review" ? { lifecycle: before } : {}),
        },
      });
      result.detached.push(receipt.id);
    }
  }
  await removeDocuments(
    userId,
    archives.map((a) => a.id),
  );
  await logAudit({
    userId,
    action: "REMOVE_FINANCAS_RECEIPT",
    resourceType: "lease",
    resourceId: named.leaseId ?? undefined,
    details: { number: named.financasNumber, ...result },
  });
  return result;
}

const termDates = (lease: Pick<TermLease, "startDate" | "endDate">, term: TermChange) => ({
  startDate: term.startDate ? new Date(`${term.startDate}T00:00:00.000Z`) : lease.startDate,
  endDate: term.endDate ? new Date(`${term.endDate}T00:00:00.000Z`) : lease.endDate,
});

/**
 * Move an active contract's term to take a recibo's month, and write the months it now owes. The
 * months a new start adds before the old one, other than the recibo's own, are waived: they were
 * never tracked, as the months before "Track rent from" are not.
 */
async function extendTerm(
  userId: string,
  lease: TermLease,
  term: TermChange,
  month: ReceiptMonth,
  now: Date,
): Promise<void> {
  const prisma = getPrismaClient();
  const dates = termDates(lease, term);
  const oldStart = Date.UTC(lease.startDate.getUTCFullYear(), lease.startDate.getUTCMonth(), 1);
  const sync = await prisma.$transaction(async (tx) => {
    const before = await tx.rentPeriod.findMany({
      where: { leaseId: lease.id },
      select: { id: true },
    });
    await tx.lease.update({ where: { id: lease.id }, data: dates });
    const result = await syncLeasePeriods(lease.id, tx, now);
    if (term.startDate) {
      await tx.rentPeriod.updateMany({
        where: {
          leaseId: lease.id,
          id: { notIn: before.map((p) => p.id) },
          dueDate: { lt: new Date(oldStart) },
          NOT: { year: month.year, month: month.month },
        },
        data: { status: "waived" },
      });
    }
    return result;
  });
  await auditLeasePeriodSync(userId, lease.id, sync);
  await logAudit({
    userId,
    action: "UPDATE_LEASE",
    resourceType: "lease",
    resourceId: lease.id,
    details: {
      reason: "financas_receipt",
      month: monthKey(month),
      from: { startDate: isoDay(lease.startDate), endDate: isoDay(lease.endDate) },
      to: { startDate: isoDay(dates.startDate), endDate: isoDay(dates.endDate) },
    },
  });
}
