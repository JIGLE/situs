import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  ValidationError,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { receiptLifecycleTransitionSchema } from "@/lib/schemas/receipt.schema";
import { transitionReceipt } from "@/lib/services/receipts/service";

export const runtime = "nodejs";

// PUT /api/receipts/[id]/lifecycle — advance a receipt's document state
// (draft→review→emitted→submitted→accepted|rejected; →voided). A refusal is typed by the service
// (404, or 409 with a `reason`), and anything else is a server error, never a bad request.
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
  if (!id) throw new ValidationError("Invalid request: missing id");

  // A body that is not JSON is the caller's mistake; `withErrorHandler` would answer its
  // SyntaxError as a server error.
  const raw: unknown = await request.json().catch(() => {
    throw new ValidationError("Invalid request: the body is not JSON");
  });
  const body = parseBody(raw, receiptLifecycleTransitionSchema);
  const outcome = await transitionReceipt(scopeUserId, id, body.to, {
    voidReason: body.voidReason,
  });
  return createSuccessResponse(outcome);
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
