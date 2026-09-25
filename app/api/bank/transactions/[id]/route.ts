import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { bankTransactionActionSchema } from "@/lib/schemas/bank.schema";
import { applyTransactionAction } from "@/lib/services/bank/import";

export const runtime = "nodejs";

// PUT /api/bank/transactions/[id] — confirm | reassign | ignore | restore a movement.
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

  const body = parseBody(await request.json(), bankTransactionActionSchema);

  // The service refuses with typed errors (404, or 409 with a `reason`), which
  // `withErrorHandler` answers as themselves. Catching them here and answering 400 turned
  // every refusal into "Internal server error", and the inbox into "no connection".
  const result = await applyTransactionAction(scopeUserId, id, body.action, body.leaseId);
  return createSuccessResponse(result);
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
