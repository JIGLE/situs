import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { periodStatusAt } from "@/lib/services/allocation/rent-matrix";

export const runtime = "nodejs";

const EPSILON = 0.005;

/**
 * Situs property activity read model: Current Period Status (the reference
 * month the ledger says is next to fill) and the PaymentTimeline (recent
 * allocation events for this property's periods — RentPeriod.propertyId is
 * denormalized, so this is one query, no join through Lease). The property
 * Audit tab reads the shared AuditTrail component (GET /api/audit-trail)
 * instead — one reusable surface, not a per-page query.
 */
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  let propertyId: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    propertyId = resolved?.id;
  }
  if (!propertyId) {
    return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  }

  const url = new URL(request.url);
  const yearParam = Number(url.searchParams.get("year"));
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
      ? yearParam
      : new Date().getUTCFullYear();

  const prisma = getPrismaClient();
  const property = await prisma.property.findFirst({
    where: { id: propertyId, userId: scopeUserId },
    select: { id: true },
  });
  if (!property) return createErrorResponse(new Error("Property not found"), 404, request);

  const periods = await prisma.rentPeriod.findMany({
    where: { propertyId, userId: scopeUserId },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      dueDate: true,
      dueAmount: true,
      allocatedAmount: true,
      paidAt: true,
    },
  });
  // A month's status as of now: the stored column does not know a due date passed.
  const now = new Date();
  const openPeriod =
    periods.find((p) => p.status !== "waived" && p.allocatedAmount < p.dueAmount - EPSILON) ??
    periods.at(-1) ??
    null;

  // Year strip: the requested year's 12 reference months, keyed by month (1-12).
  // Derived from the same `periods` fetch above — no extra query. If a property
  // ever has two leases with a period in the same month (tenant turnover), the
  // later-ordered one wins; this is a display simplification, not a ledger change.
  const yearMonths: Record<number, { status: string; dueAmount: number; allocatedAmount: number }> =
    {};
  for (const p of periods) {
    if (p.year !== year) continue;
    yearMonths[p.month] = {
      status: periodStatusAt(p, now),
      dueAmount: p.dueAmount,
      allocatedAmount: p.allocatedAmount,
    };
  }

  let receiptLifecycle: string | null = null;
  if (openPeriod) {
    const receipt = await prisma.receipt.findFirst({
      where: { rentPeriodId: openPeriod.id },
      orderBy: { createdAt: "desc" },
      select: { lifecycle: true },
    });
    receiptLifecycle = receipt?.lifecycle ?? null;
  }

  const allocations = await prisma.paymentAllocation.findMany({
    where: { rentPeriod: { propertyId, userId: scopeUserId } },
    orderBy: { allocatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      amount: true,
      type: true,
      allocatedAt: true,
      reversedAt: true,
      createdBy: true,
      rentPeriod: { select: { year: true, month: true } },
    },
  });

  return createSuccessResponse({
    currentPeriod: openPeriod
      ? {
          year: openPeriod.year,
          month: openPeriod.month,
          status: periodStatusAt(openPeriod, now),
          dueAmount: openPeriod.dueAmount,
          allocatedAmount: openPeriod.allocatedAmount,
        }
      : null,
    yearStrip: { year, months: yearMonths },
    receiptLifecycle,
    timeline: allocations.map((a) => ({
      id: a.id,
      amount: a.amount,
      type: a.type,
      allocatedAt: a.allocatedAt,
      reversedAt: a.reversedAt,
      createdBy: a.createdBy,
      period: a.rentPeriod,
    })),
  });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
