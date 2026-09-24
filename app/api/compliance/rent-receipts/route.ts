/**
 * API Route: /api/compliance/rent-receipts
 * GET  — List receipts for authenticated user
 * POST — Create a new Recibo de Renda Eletrónico
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import { createRentReceipt, listRentReceipts } from "@/lib/compliance/rent-receipts-pt";
import { logAudit } from "@/lib/services/audit-log";
import { withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import type { RentReceiptInput } from "@/lib/compliance/rent-receipts-pt";

// ─── Request body schema ────────────────────────────────────────────────────
const rentReceiptPostSchema = z.object({
  tenantId: z.string().cuid(),
  propertyId: z.string().cuid(),
  leaseId: z.string().cuid().optional(),
  landlordNif: z.string().min(9).max(9),
  tenantNif: z.string().min(9).max(9).optional(),
  propertyAddress: z.string().min(5),
  cadasterReference: z.string().optional(),
  rentAmount: z.number().positive(),
  withholdingRate: z.number().min(0).max(1).optional(),
  paymentDate: z.string().datetime(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  isRendaAcessivel: z.boolean().optional(),
});

// ─── Handlers ──────────────────────────────────────────────────────────────
async function handleGet(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? undefined;
  const propertyId = url.searchParams.get("propertyId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const year = url.searchParams.get("year")
    ? parseInt(url.searchParams.get("year")!, 10)
    : undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

  const result = await listRentReceipts(userId, {
    tenantId,
    propertyId,
    status,
    year,
    page,
    limit,
  });

  await logAudit({
    userId,
    action: "VIEW_RENT_RECEIPTS",
    resourceType: "RentReceipt",
    details: { tenantId, propertyId, status, year, page, limit, resultCount: result.total },
  });

  return NextResponse.json(result);
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const rawBody: unknown = await request.json();
  const parsed = rentReceiptPostSchema.safeParse(rawBody);
  if (!parsed.success) {
    // Audit the validation failure for observability. Use the same action as successful
    // creations (`CREATE_RENT_RECEIPT`) so downstream audit queries remain consistent.
    await logAudit({
      userId,
      action: "CREATE_RENT_RECEIPT",
      resourceType: "RentReceipt",
      details: { body: rawBody, errors: parsed.error.flatten().fieldErrors },
    });

    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // The receipt is filed against these records and the XML for AT is built from it. None of the
  // three ids was checked, so a caller could file a Recibo de Renda against another landlord's
  // tenant and property.
  await assertOwnsRelations(userId, {
    tenantId: body.tenantId,
    propertyId: body.propertyId,
    leaseId: body.leaseId,
  });

  const input: RentReceiptInput = {
    userId,
    tenantId: body.tenantId,
    propertyId: body.propertyId,
    leaseId: body.leaseId,
    landlordNif: body.landlordNif,
    tenantNif: body.tenantNif,
    propertyAddress: body.propertyAddress,
    cadasterReference: body.cadasterReference,
    rentAmount: body.rentAmount,
    withholdingRate: body.withholdingRate,
    paymentDate: new Date(body.paymentDate),
    periodStart: new Date(body.periodStart),
    periodEnd: new Date(body.periodEnd),
    isRendaAcessivel: body.isRendaAcessivel,
  };

  const result = await createRentReceipt(input);

  await logAudit({
    userId,
    action: "CREATE_RENT_RECEIPT",
    resourceType: "RentReceipt",
    resourceId: result.receiptId,
    details: {
      success: result.success,
      tenantId: body.tenantId,
      propertyId: body.propertyId,
      receiptNumber: result.receiptNumber,
      errors: result.errors,
    },
  });

  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.errors },
      { status: 400 },
    );
  }

  return NextResponse.json(result, { status: 201 });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
