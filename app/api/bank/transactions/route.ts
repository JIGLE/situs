import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { isTestConnection } from "@/lib/services/bank/metadata";
import {
  recordedPaymentsForMovements,
  summarizeRecordedPayment,
} from "@/lib/services/bank/recorded-payments";
import { expenseHintsForMovements } from "@/lib/services/expenses/bank-expenses";

export const runtime = "nodejs";

const INBOX_STATUSES = [
  "imported",
  "auto_matched",
  "needs_review",
  "matched_confirmed",
  "ignored",
  "duplicate",
] as const;

/** Money in (`in`) or money out (`out`, which includes reversals). Anything else: both. */
function directionFilter(direction: string | null) {
  if (direction === "in") return { amount: { gt: 0 } };
  if (direction === "out") return { amount: { lte: 0 } };
  return {};
}

// GET /api/bank/transactions?status=needs_review&direction=in — the movements inbox.
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = INBOX_STATUSES.find((s) => s === statusParam);

  const prisma = getPrismaClient();
  const transactions = await prisma.bankTransaction.findMany({
    where: {
      userId: scopeUserId,
      ...(status ? { status } : {}),
      ...directionFilter(url.searchParams.get("direction")),
    },
    orderBy: [{ bookingDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      amount: true,
      currency: true,
      bookingDate: true,
      valueDate: true,
      counterpartyName: true,
      reference: true,
      status: true,
      suggestedLeaseId: true,
      matchConfidence: true,
      matchReasons: true,
      duplicateOfId: true,
      receiptId: true,
      expenseId: true,
      counterpartyIbanHash: true,
      // The expense money going out paid, to name it on the row.
      expense: {
        select: {
          id: true,
          date: true,
          category: true,
          amount: true,
          property: { select: { name: true } },
        },
      },
      // Only to tell a test connection's movements apart: the metadata never leaves this route.
      bankAccount: { select: { label: true, connection: { select: { metadata: true } } } },
    },
  });

  // Resolve suggested-lease display names in one query (advisory field, no FK).
  const leaseIds = [
    ...new Set(transactions.map((t) => t.suggestedLeaseId).filter((id): id is string => !!id)),
  ];
  const leases = leaseIds.length
    ? await prisma.lease.findMany({
        where: { id: { in: leaseIds }, userId: scopeUserId },
        select: {
          id: true,
          tenant: { select: { name: true } },
          property: { select: { name: true } },
        },
      })
    : [];
  const leaseNames = new Map(
    leases.map((l) => [l.id, { tenantName: l.tenant.name, propertyName: l.property.name }]),
  );

  // The payments the owner recorded by hand that a movement still waiting may be the same money as,
  // for the ones with a lease suggested and no receipt of their own, in one query. A test
  // connection's movements stand for no real payment, so they are never offered one.
  const recorded = await recordedPaymentsForMovements(
    scopeUserId,
    transactions
      .filter(
        (t) =>
          (t.status === "needs_review" || t.status === "imported") &&
          !t.receiptId &&
          !isTestConnection(t.bankAccount.connection.metadata),
      )
      .map((t) => ({
        id: t.id,
        suggestedLeaseId: t.suggestedLeaseId,
        amount: t.amount,
        bookingDate: t.bookingDate,
      })),
  );

  // For money going out that still waits: the expenses it may have paid, and the payee's last
  // expense for the form to open with. Never a test connection's: sandbox money pays nothing.
  const expenseHints = await expenseHintsForMovements(
    scopeUserId,
    transactions.filter(
      (t) =>
        t.amount < 0 &&
        (t.status === "needs_review" || t.status === "imported") &&
        !t.expenseId &&
        !isTestConnection(t.bankAccount.connection.metadata),
    ),
  );

  return createSuccessResponse(
    // The payee's hash only serves the hints above: it never leaves this route.
    transactions.map(({ bankAccount, counterpartyIbanHash: _hash, expense, ...t }) => ({
      ...t,
      expense: expense
        ? {
            id: expense.id,
            date: expense.date,
            category: expense.category,
            amount: expense.amount,
            propertyName: expense.property.name,
          }
        : null,
      expenseSuggestions: expenseHints.get(t.id)?.suggestions ?? [],
      payee: expenseHints.get(t.id)?.payee ?? null,
      bankAccount: { label: bankAccount.label },
      suggestedLease: t.suggestedLeaseId ? (leaseNames.get(t.suggestedLeaseId) ?? null) : null,
      recordedPayments: (recorded.get(t.id) ?? []).map(summarizeRecordedPayment),
    })),
  );
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
