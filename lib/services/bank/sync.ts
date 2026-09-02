/**
 * Pulling movements from a connected bank.
 *
 * This module is deliberately thin. It decides WHEN a provider may be called and WHERE the rows
 * land; it does not decide what a row means. Once `fetchTransactions` returns `BankCsvRow[]`, the
 * rows go straight into `importBankRows`, which already owns fingerprint dedupe, the fuzzy
 * duplicate window, reconciliation rules, confidence scoring and the 0.85 auto-allocation
 * threshold. A synced movement is therefore indistinguishable from an uploaded one downstream,
 * which is the property that makes a live connection safe to add to a working ledger.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { logger } from "@/lib/utils/logger";
import { importBankRows, type ImportSummary } from "./import";
import { getProviderForConnection } from "./providers/registry";
import { ConsentExpiredError } from "./providers/types";

/**
 * Fallback read budget for a connection whose provider is no longer registered.
 *
 * The real number is `BankDataProvider.dailyReadBudget` — a commercial term the adapter owns. This
 * only covers the case where a stored connection names a provider this build no longer ships, and
 * it is deliberately the most conservative value: under-syncing costs a delay, over-syncing can
 * cost a whole day of 429s.
 */
const FALLBACK_DAILY_BUDGET = 1;

/**
 * Reads allowed per day for whatever provider backs this connection.
 *
 * Counted per connection rather than per account, because `BankSyncJob` has no account column. For
 * a connection holding several accounts that is conservative — one run spends one unit per account,
 * so the budget is reached sooner than the provider would actually refuse. That is the right
 * direction to be wrong in.
 */
function budgetFor(providerColumn: string): number {
  return getProviderForConnection(providerColumn)?.dailyReadBudget ?? FALLBACK_DAILY_BUDGET;
}

/**
 * Days of overlap re-requested on each sync.
 *
 * Asking only for movements since the last sync looks tidy and loses data: banks book
 * transactions late, and anything settled after our cursor moved past its date would never be
 * seen again. Re-fetching is close to free because the fingerprint constraint makes the import
 * idempotent — a duplicate is counted and skipped, not inserted.
 */
const OVERLAP_DAYS = 3;

export class SyncBudgetExceededError extends Error {
  readonly resetAt: Date;

  constructor(resetAt: Date, budget: number) {
    super(
      `This account has used its ${budget} bank reads for today. ` +
        `More are available after ${resetAt.toISOString()}.`,
    );
    this.name = "SyncBudgetExceededError";
    this.resetAt = resetAt;
  }
}

export class ConnectionNotSyncableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ConnectionNotSyncableError";
  }
}

export interface SyncResult {
  connectionId: string;
  /** Accounts the provider was asked about — including any that returned nothing. */
  accountsChecked: number;
  summaries: ImportSummary[];
  /** Reads still available for this connection today, after this run. */
  remainingBudget: number;
}

/** Midnight UTC tonight — when the provider's daily counter rolls over. */
function nextReset(now: Date): Date {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return reset;
}

function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Reads already spent on this connection today. Counted from `BankSyncJob` rather than held in
 * memory so the budget survives a restart — a container that restarts twice must not get twelve
 * reads.
 */
async function spentToday(connectionId: string, now: Date): Promise<number> {
  const prisma = getPrismaClient();
  return prisma.bankSyncJob.count({
    where: { connectionId, type: "api_sync", startedAt: { gte: startOfDay(now) } },
  });
}

/** Reads still available on a connection today. */
export async function remainingBudget(
  connectionId: string,
  providerColumn: string,
  now = new Date(),
): Promise<number> {
  return Math.max(0, budgetFor(providerColumn) - (await spentToday(connectionId, now)));
}

/**
 * Pull new movements for one connection.
 *
 * Scoped by `userId` at the query, not checked afterwards — a connection belonging to someone
 * else must be indistinguishable from one that does not exist.
 */
export async function syncConnection(
  userId: string,
  connectionId: string,
  now = new Date(),
): Promise<SyncResult> {
  const prisma = getPrismaClient();

  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, userId },
    include: { accounts: { where: { isActive: true } } },
  });
  if (!connection) {
    throw new ConnectionNotSyncableError("Bank connection not found");
  }

  const provider = getProviderForConnection(connection.provider);
  if (!provider) {
    // Manual and CSV connections reach here only if the UI offered a button it should not have.
    throw new ConnectionNotSyncableError(
      "This connection imports movements by file and cannot be synced",
    );
  }
  if (connection.status !== "active") {
    throw new ConnectionNotSyncableError(
      connection.status === "expired"
        ? "Bank consent has expired. Reconnect the account to resume syncing."
        : `Connection is ${connection.status} and cannot be synced`,
    );
  }

  // `consentExpiresAt` was written at consent time and then read by nothing that enforced it:
  // expiry was discovered only when the provider rejected a call, which spends a read from the
  // daily budget to learn something the row already knew. Worse, the budget is counted from the
  // job rows a successful import writes, so a failed call is not counted — an expired
  // connection could burn the provider's rate limit on repeated attempts that could never work.
  //
  // Checked here, before the budget check, because an expired consent is not a budget problem
  // and should not report itself as one.
  if (connection.consentExpiresAt && connection.consentExpiresAt.getTime() <= now.getTime()) {
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "expired" },
    });
    await logAudit({
      userId,
      action: "BANK_CONSENT_EXPIRED",
      resourceType: "bank_connection",
      resourceId: connection.id,
      details: {
        institutionName: connection.institutionName,
        expiredAt: connection.consentExpiresAt.toISOString(),
        detectedBy: "expiry_check",
      },
    });
    throw new ConsentExpiredError(
      "Bank consent has expired. Reconnect the account to resume syncing.",
    );
  }

  const budget = budgetFor(connection.provider);
  const spent = await spentToday(connectionId, now);
  if (spent >= budget) {
    throw new SyncBudgetExceededError(nextReset(now), budget);
  }

  const since = connection.lastSyncAt
    ? new Date(connection.lastSyncAt.getTime() - OVERLAP_DAYS * 24 * 60 * 60 * 1000)
    : undefined;

  const summaries: ImportSummary[] = [];
  for (const account of connection.accounts) {
    const accountRef = providerAccountRef(connection.metadata, account.id);
    if (!accountRef) continue;

    try {
      const rows = await provider.fetchTransactions(accountRef, since);

      // Imported even when empty, deliberately. The provider call has already been spent, and the
      // budget above is counted from these job rows — skipping the write on a quiet day would let
      // someone waiting on a payment press "Sync now" indefinitely without ever being counted.
      // A recorded run of zero is also the honest answer to "did it check?".
      summaries.push(
        await importBankRows(userId, rows, "api_sync", {
          connectionId: connection.id,
          bankAccountId: account.id,
        }),
      );
    } catch (error) {
      if (error instanceof ConsentExpiredError) {
        // The one failure that must never be reported as "0 new movements": that reads as a
        // quiet success and the feature is then silently off until someone notices missing rent.
        await prisma.bankConnection.update({
          where: { id: connection.id },
          data: { status: "expired" },
        });
        await logAudit({
          userId,
          action: "BANK_CONSENT_EXPIRED",
          resourceType: "bank_connection",
          resourceId: connection.id,
          details: { institutionName: connection.institutionName },
        });
      }
      throw error;
    }
  }

  return {
    connectionId: connection.id,
    accountsChecked: summaries.length,
    summaries,
    remainingBudget: Math.max(0, budget - (spent + 1)),
  };
}

/**
 * The provider's own id for an account.
 *
 * Stored in the connection's `metadata` JSON as `accountRefs: { <bankAccountId>: <providerRef> }`
 * — a map rather than a column because it is provider-specific and `BankAccount` is shared with
 * manual import, which has no such id.
 */
function providerAccountRef(metadata: string | null, bankAccountId: string): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { accountRefs?: Record<string, string> };
    return parsed.accountRefs?.[bankAccountId] ?? null;
  } catch {
    return null;
  }
}

export interface ScheduledSyncReport {
  attempted: number;
  succeeded: number;
  failed: number;
  expired: number;
}

/**
 * The daily scheduled run.
 *
 * Every active provider connection that has not been synced yet today, each isolated: one expired
 * consent or one provider outage must not stop the rest of the estate from syncing. Failures are
 * counted and logged rather than thrown, because the caller is a cron endpoint whose only useful
 * response is a summary.
 */
export async function syncAllDueConnections(now = new Date()): Promise<ScheduledSyncReport> {
  const prisma = getPrismaClient();
  const report: ScheduledSyncReport = { attempted: 0, succeeded: 0, failed: 0, expired: 0 };

  const due = await prisma.bankConnection.findMany({
    where: {
      status: "active",
      provider: { startsWith: "psd2_" },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: startOfDay(now) } }],
    },
    select: { id: true, userId: true },
  });

  for (const connection of due) {
    report.attempted += 1;
    try {
      await syncConnection(connection.userId, connection.id, now);
      report.succeeded += 1;
    } catch (error) {
      if (error instanceof ConsentExpiredError) {
        report.expired += 1;
      } else {
        report.failed += 1;
      }
      logger.warn("Scheduled bank sync failed for a connection", {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}
