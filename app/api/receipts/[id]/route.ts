import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
  readJsonObject,
} from "@/lib/utils/error-handling";
import { ReceiptFiledError, receiptService } from "@/lib/services/database/receipt";
import { sanitizeForDatabase, sanitizeNumber } from "@/lib/utils/sanitize";
import { z } from "zod";
import { updateReceiptSchema } from "@/lib/schemas/receipt.schema";
import { allocateReceipt } from "@/lib/services/allocation/service";
import { logger } from "@/lib/utils/logger";

// GET /api/receipts/[id] - Get a specific receipt
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    const receipt = await receiptService.getById(userId, id);

    if (!receipt) {
      return createErrorResponse(new Error("Receipt not found"), 404, request);
    }

    return createSuccessResponse(receipt);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/receipts/[id] - Update a specific receipt
async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    // First check if receipt exists and user owns it
    const existingReceipt = await receiptService.getById(userId, id);
    if (!existingReceipt) {
      return createErrorResponse(new Error("Receipt not found"), 404, request);
    }

    const body = await readJsonObject(request);

    // Sanitize input
    const sanitizedBody = {
      ...body,
      tenantId: body.tenantId ? sanitizeForDatabase(body.tenantId) : undefined,
      propertyId: body.propertyId ? sanitizeForDatabase(body.propertyId) : undefined,
      amount: body.amount !== undefined ? sanitizeNumber(body.amount, 0.01, 0.01) : undefined,
      description: body.description ? sanitizeForDatabase(body.description) : undefined,
    };

    // Validate input
    const validatedData = updateReceiptSchema.parse(sanitizedBody);

    const receipt = await receiptService.update(userId, id, validatedData);

    // "paid" means the money arrived and is in the ledger. A receipt recorded as expected and
    // marked paid later is allocated now, as one created paid is; before, it read "paid" while
    // the months it paid still read unpaid. Best effort, as at creation, and idempotent.
    if (existingReceipt.status !== "paid" && receipt.status === "paid") {
      try {
        await allocateReceipt(receipt.id);
      } catch (allocErr) {
        logger.error("Receipt allocation failed", allocErr, { receiptId: receipt.id });
      }
    }
    return createSuccessResponse(receipt);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        new Error(`Validation error: ${error.issues.map((e) => e.message).join(", ")}`),
        400,
        request,
      );
    }
    return createErrorResponse(error as Error, 500, request);
  }
}

// DELETE /api/receipts/[id] - Delete a specific receipt
async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    // First check if receipt exists and user owns it
    const existingReceipt = await receiptService.getById(userId, id);
    if (!existingReceipt) {
      return createErrorResponse(new Error("Receipt not found"), 404, request);
    }

    await receiptService.delete(userId, id);
    return createSuccessResponse({ message: "Receipt deleted successfully" });
  } catch (error) {
    // Filed at Finanças: it stays as the record of that submission, and only the Portal voids it.
    if (error instanceof ReceiptFiledError) return createErrorResponse(error, 409, request);
    return createErrorResponse(error as Error, 500, request);
  }
}

// Main handler
export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
