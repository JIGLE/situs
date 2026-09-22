import { NextRequest } from "next/server";
import {
  getAccessContext,
  handleOptions,
  requireOwnerAccess,
} from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { receiptService } from "@/lib/services/database/receipt";
import { sanitizeForDatabase, sanitizeNumber } from "@/lib/utils/sanitize";
import { getPaginationFromRequest, createPaginatedResponse } from "@/lib/utils/pagination";
import { logger } from "@/lib/utils/logger";
import { getPrismaClient } from "@/lib/services/database/database";
import { createReceiptSchema } from "@/lib/schemas/receipt.schema";

// GET /api/receipts - Get all receipts for the authenticated user (with pagination)
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await getAccessContext(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;

  try {
    // Check if pagination is requested
    const url = new URL(request.url);
    const usePagination = url.searchParams.has("page") || url.searchParams.has("limit");

    if (usePagination) {
      // Paginated response
      const pagination = getPaginationFromRequest(request, 50, 100);
      const prisma = getPrismaClient();

      const [receipts, total] = await Promise.all([
        prisma.receipt.findMany({
          where: { userId: scopeUserId },
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { date: "desc" },
        }),
        prisma.receipt.count({
          where: { userId: scopeUserId },
        }),
      ]);

      return createSuccessResponse(createPaginatedResponse(receipts, total, pagination));
    } else {
      // Legacy: Return all receipts (backward compatible)
      const receipts = await receiptService.getAll(scopeUserId);
      return createSuccessResponse(receipts);
    }
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// POST /api/receipts - Create a new receipt
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;

  const raw = await request.json();
  const sanitizedBody = {
    ...raw,
    tenantId: sanitizeForDatabase(raw.tenantId),
    propertyId: sanitizeForDatabase(raw.propertyId),
    amount: sanitizeNumber(raw.amount, 0.01, 0.01),
    description: raw.description ? sanitizeForDatabase(raw.description) : undefined,
  };

  const validatedData = parseBody(sanitizedBody, createReceiptSchema);
  const receipt = await receiptService.create(scopeUserId, validatedData);

  // Situs reference-month workflow: run the allocation waterfall for rent
  // receipts (idempotent; ambiguous multi-lease tenants are skipped for
  // review). Never blocks receipt creation — allocation is best-effort here
  // and re-runnable via the backfill script.
  try {
    const { allocateReceipt } = await import("@/lib/services/allocation/service");
    await allocateReceipt(receipt.id);
  } catch (allocErr) {
    logger.error("Receipt allocation failed", allocErr, { receiptId: receipt.id });
  }

  return createSuccessResponse(receipt, 201);
}

// Main handler
export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
