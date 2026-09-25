import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import type { BankInboxSummary } from "@/lib/utils/bank-inbox";

export const runtime = "nodejs";

// GET /api/bank/transactions/summary — how many movements each inbox filter holds.
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const prisma = getPrismaClient();
  const [byStatus, outgoing] = await Promise.all([
    prisma.bankTransaction.groupBy({
      by: ["status"],
      where: { userId: scopeUserId },
      _count: { _all: true },
    }),
    // Money going out waits in `needs_review` too, since rules and matching never run for it.
    // It is not work: nothing about it can be confirmed as rent, so it is counted apart.
    prisma.bankTransaction.count({
      where: { userId: scopeUserId, status: "needs_review", amount: { lte: 0 } },
    }),
  ]);
  const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;

  const summary: BankInboxSummary = {
    toReview: count("needs_review") - outgoing,
    outgoing,
    autoMatched: count("auto_matched"),
    confirmed: count("matched_confirmed"),
    ignored: count("ignored"),
    all: byStatus.reduce((total, row) => total + row._count._all, 0),
  };
  return createSuccessResponse(summary);
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
