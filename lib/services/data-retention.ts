/**
 * GDPR data retention service.
 *
 * Retention policy (Article 5(1)(e) GDPR — storage limitation):
 *   - Audit logs:      7 years  (tax / legal obligation, Art. 17(3)(b))
 *   - Email logs:      2 years  (operational need)
 *   - Notifications:   1 year   (no ongoing value after archival)
 *   - Bank movements:  2 years  — UNRECONCILED ONLY, see below
 *   - Bank sync jobs:  2 years  (operational log of an import run)
 *   - Abandoned consents: 24 hours, see below
 *
 * Bank data was retained forever until this existed, which is the shape of storage-limitation
 * problem that only appears once a live PSD2 feed is connected: an unmatched movement is a
 * counterparty name, an IBAN and a free-text remittance line about a real person, kept for no
 * stated purpose and no stated period.
 *
 * TWO DELIBERATE NARROWINGS, because "delete old bank data" is the wrong rule:
 *
 *   1. Only movements with NO receipt link are deleted. A matched movement is the provenance
 *      of a Receipt — the evidence of where that money came from — and PT/ES fiscal records
 *      outlive two years. Deleting it would leave a receipt whose origin cannot be shown,
 *      which is worse for the subject and for the operator than keeping it. Matched movements
 *      are governed by the retention of the receipt they belong to.
 *
 *   2. Consent reaping targets connections that never completed. `startConsent` writes a live
 *      256-bit reference into `BankConnection.metadata` and creates the row BEFORE calling the
 *      provider, dropping the reference only on success. Every abandoned attempt therefore
 *      left a usable reference sitting in the database indefinitely. The delete is scoped to
 *      rows still `pending_consent` AND holding no accounts, because deleting a BankConnection
 *      cascades to BankAccount and BankTransaction — a status check alone would be one bug
 *      away from deleting real financial data.
 *
 * Run daily via /api/cron/data-retention.
 */

import { getPrismaClient } from "@/lib/services/database/database";

export interface RetentionResult {
  auditLogsDeleted: number;
  emailLogsDeleted: number;
  notificationsDeleted: number;
  /** Unreconciled movements only — matched ones follow their receipt. */
  bankTransactionsDeleted: number;
  bankSyncJobsDeleted: number;
  /** Consent flows started and never completed, whose reference was still live. */
  abandonedConsentsDeleted: number;
  ranAt: string;
}

const RETENTION_DAYS = {
  auditLogs: 7 * 365,
  emailLogs: 2 * 365,
  notifications: 365,
  /** Matches the 730-day history a consent requests, so we never hold more than we asked for. */
  unreconciledBankTransactions: 2 * 365,
  bankSyncJobs: 2 * 365,
} as const;

/**
 * A consent flow that has not completed within a day is not going to. The window is generous
 * for a redirect that takes minutes: the cost of it being too long is a live reference sitting
 * in the database, and the cost of it being too short is a user losing a flow mid-authorisation.
 */
const ABANDONED_CONSENT_HOURS = 24;

function cutoff(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export async function runDataRetention(): Promise<RetentionResult> {
  const prisma = getPrismaClient();

  const [auditResult, emailResult, notifResult, bankTxnResult, syncJobResult] = await Promise.all([
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff(RETENTION_DAYS.auditLogs) } },
    }),
    prisma.emailLog.deleteMany({
      where: { createdAt: { lt: cutoff(RETENTION_DAYS.emailLogs) } },
    }),
    prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoff(RETENTION_DAYS.notifications) },
        read: true,
      },
    }),
    // `receiptId: null` is the whole safety property here: a movement that became a receipt is
    // that receipt's evidence and is not ours to delete on this schedule.
    prisma.bankTransaction.deleteMany({
      where: {
        bookingDate: { lt: cutoff(RETENTION_DAYS.unreconciledBankTransactions) },
        receiptId: null,
      },
    }),
    prisma.bankSyncJob.deleteMany({
      where: { startedAt: { lt: cutoff(RETENTION_DAYS.bankSyncJobs) } },
    }),
  ]);

  // Sequential rather than in the batch above: this one reads before it deletes, and it must
  // see the state left by nothing else in this run.
  const abandonedConsentResult = await prisma.bankConnection.deleteMany({
    where: {
      status: "pending_consent",
      createdAt: { lt: hoursAgo(ABANDONED_CONSENT_HOURS) },
      // Belt and braces against the cascade. A pending_consent row should never have accounts —
      // persistAccounts writes them and flips the status in the same flow — but "should never"
      // is not a guarantee, and the failure mode here is deleting somebody's financial history.
      accounts: { none: {} },
    },
  });

  return {
    auditLogsDeleted: auditResult.count,
    emailLogsDeleted: emailResult.count,
    notificationsDeleted: notifResult.count,
    bankTransactionsDeleted: bankTxnResult.count,
    bankSyncJobsDeleted: syncJobResult.count,
    abandonedConsentsDeleted: abandonedConsentResult.count,
    ranAt: new Date().toISOString(),
  };
}

export { RETENTION_DAYS, ABANDONED_CONSENT_HOURS };
