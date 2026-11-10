import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";

export const runtime = "nodejs";

const EPSILON = 0.005;

/**
 * Situs tenant relationship map: a read-only cross-domain summary — lease →
 * rent periods → bank movements → receipts — for the
 * People tenant detail relationship-map strip. Mirrors the property activity
 * read model (GET /api/properties/[id]/activity): several small scoped
 * queries rather than one large join, matching that route's style.
 */
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  let tenantId: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    tenantId = resolved?.id;
  }
  if (!tenantId) {
    return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  }

  const prisma = getPrismaClient();
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, userId: scopeUserId },
    select: { id: true },
  });
  if (!tenant) return createErrorResponse(new Error("Tenant not found"), 404, request);

  const leases = await prisma.lease.findMany({
    where: { tenantId, userId: scopeUserId },
    select: { id: true, status: true },
  });

  const periods = await prisma.rentPeriod.findMany({
    where: { tenantId, userId: scopeUserId },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      dueAmount: true,
      allocatedAmount: true,
    },
  });
  const currentPeriod =
    periods.find((p) => p.allocatedAmount < p.dueAmount - EPSILON) ?? periods.at(-1) ?? null;
  const overdueCount = periods.filter(
    (p) => p.status === "overdue" || p.status === "paid_late",
  ).length;

  const receipts = await prisma.receipt.findMany({
    where: { tenantId, userId: scopeUserId },
    orderBy: { createdAt: "desc" },
    select: { id: true, lifecycle: true, createdAt: true },
  });
  const lastReceipt = receipts.at(0) ?? null;

  const receiptIds = receipts.map((r) => r.id);
  const matchedBankMovements = receiptIds.length
    ? await prisma.bankTransaction.findMany({
        where: { receiptId: { in: receiptIds }, userId: scopeUserId },
        orderBy: { bookingDate: "desc" },
        select: { id: true, bookingDate: true },
      })
    : [];

  return createSuccessResponse({
    leases: {
      total: leases.length,
      active: leases.filter((l) => l.status === "active").length,
    },
    periods: {
      total: periods.length,
      overdue: overdueCount,
      current: currentPeriod
        ? { year: currentPeriod.year, month: currentPeriod.month, status: currentPeriod.status }
        : null,
    },
    bankMovements: {
      matched: matchedBankMovements.length,
      lastMatchedAt: matchedBankMovements.at(0)?.bookingDate ?? null,
    },
    receipts: {
      total: receipts.length,
      lastLifecycle: lastReceipt?.lifecycle ?? null,
      lastAt: lastReceipt?.createdAt ?? null,
    },
  });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
