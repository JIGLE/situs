import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { receiptLifecycleTransitionSchema } from "@/lib/schemas/receipt.schema";
import { transitionReceipt } from "@/lib/services/receipts/service";

export const runtime = "nodejs";

// PUT /api/receipts/[id]/lifecycle — advance a receipt's document state
// (draft→review→emitted→submitted→accepted|rejected; →voided).
async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  let id: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const body = parseBody(await request.json(), receiptLifecycleTransitionSchema);

  try {
    const outcome = await transitionReceipt(scopeUserId, id, body.to, {
      voidReason: body.voidReason,
    });
    return createSuccessResponse(outcome);
  } catch (error) {
    return createErrorResponse(error as Error, 400, request);
  }
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
