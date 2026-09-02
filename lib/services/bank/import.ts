/**
 * Situs bank import service — Prisma orchestration around the pure matching
 * engine (lib/services/matching/engine).
 *
 * Pipeline per imported row:
 *   fingerprint dedupe (exact) → fuzzy-duplicate check → reconciliation rules
 *   → confidence scoring → auto-match (create automation Receipt → existing
 *   allocation waterfall) or needs_review.
 *
 * IBANs are stored AES-256-GCM encrypted (repo PII pattern) with a SHA-256
 * hash column so matching and dedupe never require decryption. A month token
 * in the remittance text never silently overrides the waterfall: when it
 * disagrees with the oldest-unpaid target the row goes to review showing both.
 */

import crypto from "crypto";

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { encryptPII } from "@/lib/utils/pii-encryption";
import { allocateReceipt } from "@/lib/services/allocation/service";
import { isTestConnection } from "@/lib/services/bank/consent";
import { redactRowForStorage } from "@/lib/services/bank/csv";
import {
  classifyMatch,
  findPossibleDuplicate,
  normalizeText,
  parseReferenceMonth,
  type LeaseCandidate,
  type TransactionInput,
} from "@/lib/services/matching/engine";
import type { BankCsvRow } from "./csv";

const EPSILON = 0.005;

export interface ImportSummary {
  jobId: string;
  imported: number;
  duplicates: number;
  autoMatched: number;
  needsReview: number;
  errors: string[];
}

export interface RuleCondition {
  field: "iban_hash" | "counterparty_name" | "reference_regex" | "amount_range";
  op: "equals" | "contains" | "matches" | "between";
  value: string | { min: number; max: number };
}

export interface RuleAction {
  type: "assign_lease" | "ignore";
  leaseId?: string;
}

export function hashIban(iban: string): string {
  const normalized = iban.replace(/\s+/g, "").toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Deterministic identity of an imported movement — an exact re-import of the
 * same statement hits the unique constraint before any matching runs.
 */
export function computeFingerprint(input: {
  bankAccountId: string;
  amount: number;
  bookingDate: string; // ISO date
  counterpartyIbanHash?: string | null;
  counterpartyName?: string | null;
  reference?: string | null;
}): string {
  const counterparty =
    input.counterpartyIbanHash ?? normalizeText(input.counterpartyName ?? "unknown");
  const material = [
    input.bankAccountId,
    input.amount.toFixed(2),
    input.bookingDate,
    counterparty,
    normalizeText(input.reference ?? ""),
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("hex");
}

/** Find-or-create the default manual connection + account for a user. */
export async function ensureManualAccount(
  userId: string,
): Promise<{ connectionId: string; bankAccountId: string }> {
  const prisma = getPrismaClient();
  let connection = await prisma.bankConnection.findFirst({
    where: { userId, provider: "manual" },
  });
  if (!connection) {
    connection = await prisma.bankConnection.create({
      data: { userId, provider: "manual", institutionName: "Manual import", status: "active" },
    });
  }
  let account = await prisma.bankAccount.findFirst({
    where: { connectionId: connection.id, isActive: true },
  });
  if (!account) {
    account = await prisma.bankAccount.create({
      data: { connectionId: connection.id, userId, label: "Manual import" },
    });
  }
  return { connectionId: connection.id, bankAccountId: account.id };
}

/**
 * Build the matching-engine candidate snapshots for a user's active leases:
 * known counterparty IBAN hashes come from previously matched movements,
 * the outstanding remainder from the oldest partially paid period, and
 * property tokens from the property name/address.
 */
export async function buildLeaseCandidates(userId: string): Promise<LeaseCandidate[]> {
  const prisma = getPrismaClient();

  const leases = await prisma.lease.findMany({
    where: { userId, status: "active" },
    select: {
      id: true,
      monthlyRent: true,
      tenant: { select: { name: true } },
      property: { select: { name: true, address: true } },
    },
  });
  if (leases.length === 0) return [];

  const knownTxns = await prisma.bankTransaction.findMany({
    where: {
      userId,
      status: { in: ["auto_matched", "matched_confirmed"] },
      counterpartyIbanHash: { not: null },
    },
    select: {
      counterpartyIbanHash: true,
      suggestedLeaseId: true,
      receipt: { select: { leaseId: true } },
    },
  });
  const ibansByLease = new Map<string, Set<string>>();
  for (const txn of knownTxns) {
    const leaseId = txn.receipt?.leaseId ?? txn.suggestedLeaseId;
    if (!leaseId || !txn.counterpartyIbanHash) continue;
    if (!ibansByLease.has(leaseId)) ibansByLease.set(leaseId, new Set());
    ibansByLease.get(leaseId)!.add(txn.counterpartyIbanHash);
  }

  const partials = await prisma.rentPeriod.findMany({
    where: { userId, status: "partially_paid", leaseId: { in: leases.map((l) => l.id) } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { leaseId: true, dueAmount: true, allocatedAmount: true },
  });
  const remainderByLease = new Map<string, number>();
  for (const p of partials) {
    if (!remainderByLease.has(p.leaseId)) {
      remainderByLease.set(p.leaseId, Math.round((p.dueAmount - p.allocatedAmount) * 100) / 100);
    }
  }

  return leases.map((lease) => ({
    leaseId: lease.id,
    tenantName: lease.tenant.name,
    monthlyRent: lease.monthlyRent,
    knownIbanHashes: [...(ibansByLease.get(lease.id) ?? [])],
    knownRemainder: remainderByLease.get(lease.id),
    propertyTokens: [lease.property.name, lease.property.address]
      .filter(Boolean)
      .flatMap((text) => normalizeText(text).split(" "))
      .filter((token) => token.length > 3),
  }));
}

function evaluateRuleCondition(
  condition: RuleCondition,
  txn: {
    amount: number;
    counterpartyIbanHash?: string | null;
    counterpartyName?: string | null;
    reference?: string | null;
  },
): boolean {
  switch (condition.field) {
    case "iban_hash":
      return !!txn.counterpartyIbanHash && txn.counterpartyIbanHash === condition.value;
    case "counterparty_name":
      return (
        !!txn.counterpartyName &&
        typeof condition.value === "string" &&
        normalizeText(txn.counterpartyName).includes(normalizeText(condition.value))
      );
    case "reference_regex":
      if (!txn.reference || typeof condition.value !== "string") return false;
      if (condition.value.length > 100) return false; // bound ReDoS blast radius
      try {
        // Pattern is the account owner's own reconciliation rule (requireOwnerAccess),
        // never third-party input; malformed/pathological patterns are caught, not run unbounded.
        // eslint-disable-next-line security/detect-non-literal-regexp
        return new RegExp(condition.value, "i").test(txn.reference);
      } catch {
        return false; // malformed user regex never crashes an import
      }
    case "amount_range":
      return (
        typeof condition.value === "object" &&
        txn.amount >= condition.value.min &&
        txn.amount <= condition.value.max
      );
    default:
      return false;
  }
}

/**
 * The waterfall's next target for a lease: its oldest not-fully-allocated
 * period. Used only to detect reference-month disagreement — allocation
 * itself always goes through the engine.
 */
async function oldestOpenPeriod(leaseId: string): Promise<{ year: number; month: number } | null> {
  const prisma = getPrismaClient();
  const periods = await prisma.rentPeriod.findMany({
    where: { leaseId, status: { not: "waived" } },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { year: true, month: true, dueAmount: true, allocatedAmount: true },
  });
  for (const p of periods) {
    if (p.allocatedAmount < p.dueAmount - EPSILON) return { year: p.year, month: p.month };
  }
  return null;
}

/** Create the automation Receipt for a matched movement and run the waterfall. */
async function createReceiptAndAllocate(
  userId: string,
  leaseId: string,
  txn: { id: string; amount: number; bookingDate: Date; counterpartyName?: string | null },
): Promise<string> {
  const prisma = getPrismaClient();
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: { tenantId: true, propertyId: true },
  });
  const receipt = await prisma.receipt.create({
    data: {
      userId,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      leaseId,
      amount: txn.amount,
      date: txn.bookingDate,
      type: "rent",
      status: "paid",
      lifecycle: "draft", // the PR-8 receipt queue reviews automation drafts
      source: "automation",
      description: txn.counterpartyName
        ? `Bank movement — ${txn.counterpartyName}`
        : "Bank movement",
    },
  });
  await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: { receiptId: receipt.id },
  });
  await allocateReceipt(receipt.id);
  return receipt.id;
}

/** Where imported rows land. Omitted for CSV and manual entry, which share one synthetic account. */
export interface ImportTarget {
  connectionId: string;
  bankAccountId: string;
}

/**
 * Import rows into the movements inbox. Idempotent: exact duplicates are
 * counted and skipped via the fingerprint unique constraint.
 *
 * `target` is what lets a live provider sync reuse this whole pipeline. Without it the rows go to
 * the find-or-created "Manual import" connection, as CSV and manual entry have always done; with
 * it they are attributed to the connection and account the movements actually came from. Nothing
 * else differs — a synced movement gets the same fingerprint dedupe, reconciliation rules,
 * confidence scoring and 0.85 auto-allocation threshold as an uploaded one, which is the point.
 */
export async function importBankRows(
  userId: string,
  rows: BankCsvRow[],
  jobType: "csv_import" | "manual_entry" | "api_sync" = "csv_import",
  target?: ImportTarget,
): Promise<ImportSummary> {
  const prisma = getPrismaClient();
  const { connectionId, bankAccountId } = target ?? (await ensureManualAccount(userId));

  /**
   * Whether these rows arrive through a connection the operator created to prove the chain works.
   *
   * Read from the connection row, not passed in: a caller that forgot the flag would silently
   * allocate sandbox money, and this is the one property of the import that must not depend on
   * every call site remembering it.
   *
   * A test connection imports identically — same fingerprint dedupe, same fuzzy-duplicate window,
   * same reconciliation rules, same confidence scoring, and the rows land in the same inbox. The
   * single thing it may not do is cross the allocation boundary: auto-creating a `Receipt` and
   * `PaymentAllocation` rows against a REAL lease out of sandbox money is not a test, it is a
   * corrupted ledger — and an irreversible one, because deleting the connection cascades to the
   * `BankTransaction` and leaves the `Receipt` behind.
   *
   * The confidence and reasons are still recorded, so the inbox can show that a row *would* have
   * matched at 0.91. That is the evidence the test is for; acting on it is not.
   */
  const quarantineFromAllocation = isTestConnection(
    (
      await prisma.bankConnection.findUnique({
        where: { id: connectionId },
        select: { metadata: true },
      })
    )?.metadata ?? null,
  );

  const job = await prisma.bankSyncJob.create({
    data: { userId, connectionId, type: jobType, status: "running" },
  });

  const summary: ImportSummary = {
    jobId: job.id,
    imported: 0,
    duplicates: 0,
    autoMatched: 0,
    needsReview: 0,
    errors: [],
  };

  const candidates = await buildLeaseCandidates(userId);
  const rules = await prisma.reconciliationRule.findMany({
    where: { userId, isActive: true },
    orderBy: { priority: "asc" },
  });

  // Fuzzy-duplicate window: recent movements around the batch's date range.
  const recentTxns = await prisma.bankTransaction.findMany({
    where: { userId, status: { notIn: ["ignored", "duplicate"] } },
    orderBy: { bookingDate: "desc" },
    take: 500,
    select: {
      id: true,
      amount: true,
      bookingDate: true,
      counterpartyIbanHash: true,
      counterpartyName: true,
      reference: true,
    },
  });
  const knownInputs: TransactionInput[] = recentTxns.map((t) => ({ ...t }));

  for (const row of rows) {
    try {
      const counterpartyIbanHash = row.counterpartyIban ? hashIban(row.counterpartyIban) : null;
      const fingerprint = computeFingerprint({
        bankAccountId,
        amount: row.amount,
        bookingDate: row.bookingDate,
        counterpartyIbanHash,
        counterpartyName: row.counterpartyName,
        reference: row.reference,
      });

      const existing = await prisma.bankTransaction.findUnique({ where: { fingerprint } });
      if (existing) {
        summary.duplicates += 1;
        continue;
      }

      const bookingDate = new Date(`${row.bookingDate}T00:00:00.000Z`);
      const txnInput: TransactionInput = {
        id: fingerprint, // engine only needs a distinct id pre-insert
        amount: row.amount,
        bookingDate,
        counterpartyIbanHash,
        counterpartyName: row.counterpartyName ?? null,
        reference: row.reference ?? null,
      };

      const warnings: string[] = [];
      let status = "needs_review";
      let suggestedLeaseId: string | null = null;
      let matchConfidence: number | null = null;
      let reasons: string[] = [];
      let appliedRule: { id: string; name: string } | null = null;
      let ignored = false;

      const duplicateOfId = findPossibleDuplicate(txnInput, knownInputs);
      if (duplicateOfId) warnings.push("possible_duplicate");

      if (row.amount <= 0) {
        // Outflows/reversals are never auto-matched — PR 8 wires the
        // confirm-side reversal flow.
        warnings.push("negative_amount");
      } else {
        for (const rule of rules) {
          let condition: RuleCondition;
          let action: RuleAction;
          try {
            condition = JSON.parse(rule.condition) as RuleCondition;
            action = JSON.parse(rule.action) as RuleAction;
          } catch {
            continue;
          }
          if (!evaluateRuleCondition(condition, txnInput)) continue;
          appliedRule = { id: rule.id, name: rule.name };
          if (action.type === "ignore") {
            ignored = true;
          } else if (action.type === "assign_lease" && action.leaseId) {
            suggestedLeaseId = action.leaseId;
            matchConfidence = 1;
            reasons = [`rule:${rule.name}`];
          }
          break;
        }

        if (!appliedRule) {
          const result = classifyMatch(txnInput, candidates);
          if (result.best && result.best.confidence >= 0.5) {
            suggestedLeaseId = result.best.leaseId;
            matchConfidence = result.best.confidence;
            reasons = [...result.best.reasons];
          }
          if (result.ambiguous) warnings.push("ambiguous_candidates");
          status = result.status;
        } else if (!ignored) {
          status = "auto_matched";
        }

        // A reference month never silently overrides the waterfall.
        if (suggestedLeaseId && row.reference) {
          const parsed = parseReferenceMonth(row.reference);
          if (parsed) {
            const target = await oldestOpenPeriod(suggestedLeaseId);
            if (target && (target.year !== parsed.year || target.month !== parsed.month)) {
              warnings.push(
                `reference_conflict:${parsed.year}-${String(parsed.month).padStart(2, "0")}` +
                  `≠${target.year}-${String(target.month).padStart(2, "0")}`,
              );
            }
          }
        }
      }

      if (ignored) status = "ignored";
      else if (
        row.amount <= 0 ||
        duplicateOfId ||
        warnings.some((w) => w.startsWith("reference_conflict"))
      ) {
        status = "needs_review";
      }

      // Applied last, and to `status` itself rather than only to the branch below, so the row
      // that is written and the action that is taken can never disagree about what happened.
      if (quarantineFromAllocation && status === "auto_matched") {
        status = "needs_review";
        warnings.push("test_connection_not_allocated");
      }

      const txn = await prisma.bankTransaction.create({
        data: {
          userId,
          bankAccountId,
          syncJobId: job.id,
          fingerprint,
          amount: row.amount,
          bookingDate,
          valueDate: row.valueDate ? new Date(`${row.valueDate}T00:00:00.000Z`) : null,
          counterpartyName: row.counterpartyName ?? null,
          counterpartyIban: row.counterpartyIban ? encryptPII(row.counterpartyIban) : null,
          counterpartyIbanHash,
          reference: row.reference ?? null,
          rawData: JSON.stringify(redactRowForStorage(row)),
          status,
          suggestedLeaseId,
          matchConfidence,
          matchReasons: JSON.stringify({ reasons, warnings, rule: appliedRule?.name ?? null }),
          duplicateOfId,
        },
      });
      knownInputs.push({ ...txnInput, id: txn.id });

      if (appliedRule) {
        await prisma.reconciliationRule.update({
          where: { id: appliedRule.id },
          data: { timesApplied: { increment: 1 }, lastAppliedAt: new Date() },
        });
        await logAudit({
          userId,
          action: "APPLY_RECONCILIATION_RULE",
          resourceType: "bank_transaction",
          resourceId: txn.id,
          details: { rule: appliedRule.name, outcome: status },
        });
      }

      if (status === "auto_matched" && suggestedLeaseId) {
        await createReceiptAndAllocate(userId, suggestedLeaseId, {
          id: txn.id,
          amount: row.amount,
          bookingDate,
          counterpartyName: row.counterpartyName,
        });
        await logAudit({
          userId,
          action: "MATCH_PAYMENT",
          resourceType: "bank_transaction",
          resourceId: txn.id,
          details: { leaseId: suggestedLeaseId, confidence: matchConfidence, reasons },
        });
        summary.autoMatched += 1;
      } else if (status === "needs_review") {
        summary.needsReview += 1;
      }
      summary.imported += 1;
    } catch (err) {
      summary.errors.push(err instanceof Error ? err.message : "Import row failed");
    }
  }

  await prisma.bankSyncJob.update({
    where: { id: job.id },
    data: {
      status: summary.errors.length === rows.length && rows.length > 0 ? "failed" : "completed",
      finishedAt: new Date(),
      stats: JSON.stringify({
        imported: summary.imported,
        duplicates: summary.duplicates,
        autoMatched: summary.autoMatched,
        needsReview: summary.needsReview,
        errors: summary.errors.length,
      }),
    },
  });

  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  await logAudit({
    userId,
    action: "IMPORT_BANK_TRANSACTIONS",
    resourceType: "bank_sync_job",
    resourceId: job.id,
    details: {
      type: jobType,
      imported: summary.imported,
      duplicates: summary.duplicates,
      autoMatched: summary.autoMatched,
      needsReview: summary.needsReview,
    },
  });

  return summary;
}

export type TransactionAction = "confirm" | "reassign" | "ignore";

/**
 * Inbox row actions. `confirm` accepts the suggestion; `reassign` overrides it
 * with an explicit lease (audited as OVERRIDE_MATCH); `ignore` parks the row.
 * Confirm/reassign create the automation Receipt and run the waterfall unless
 * the movement already has one (idempotent).
 */
export async function applyTransactionAction(
  userId: string,
  transactionId: string,
  action: TransactionAction,
  leaseId?: string,
): Promise<{ status: string; receiptId: string | null }> {
  const prisma = getPrismaClient();
  const txn = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, userId },
  });
  if (!txn) throw new Error("Transaction not found");
  if (txn.status === "matched_confirmed" && action !== "ignore") {
    return { status: txn.status, receiptId: txn.receiptId };
  }

  if (action === "ignore") {
    await prisma.bankTransaction.update({
      where: { id: txn.id },
      data: { status: "ignored" },
    });
    await logAudit({
      userId,
      action: "IGNORE_TRANSACTION",
      resourceType: "bank_transaction",
      resourceId: txn.id,
      details: { previousStatus: txn.status },
    });
    return { status: "ignored", receiptId: txn.receiptId };
  }

  const targetLeaseId = action === "reassign" ? leaseId : (leaseId ?? txn.suggestedLeaseId);
  if (!targetLeaseId) throw new Error("A lease is required to confirm this movement");
  if (txn.amount <= 0) throw new Error("Outflows cannot be allocated as rent");

  const lease = await prisma.lease.findFirst({
    where: { id: targetLeaseId, userId },
    select: { id: true },
  });
  if (!lease) throw new Error("Lease not found");

  let receiptId = txn.receiptId;
  if (!receiptId) {
    receiptId = await createReceiptAndAllocate(userId, targetLeaseId, {
      id: txn.id,
      amount: txn.amount,
      bookingDate: txn.bookingDate,
      counterpartyName: txn.counterpartyName,
    });
  }

  const overridden = txn.suggestedLeaseId && txn.suggestedLeaseId !== targetLeaseId;
  await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: { status: "matched_confirmed", suggestedLeaseId: targetLeaseId },
  });
  await logAudit({
    userId,
    action: overridden ? "OVERRIDE_MATCH" : "CONFIRM_MATCH",
    resourceType: "bank_transaction",
    resourceId: txn.id,
    details: {
      leaseId: targetLeaseId,
      previousSuggestion: txn.suggestedLeaseId,
      receiptId,
    },
  });

  return { status: "matched_confirmed", receiptId };
}
