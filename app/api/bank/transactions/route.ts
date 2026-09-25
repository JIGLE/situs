import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";

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
      bankAccount: { select: { label: true } },
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

  return createSuccessResponse(
    transactions.map((t) => ({
      ...t,
      suggestedLease: t.suggestedLeaseId ? (leaseNames.get(t.suggestedLeaseId) ?? null) : null,
    })),
  );
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
