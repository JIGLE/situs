import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { ConsentFlowError, startRenewal } from "@/lib/services/bank/consent";

export const runtime = "nodejs";

/**
 * POST /api/bank/connections/[id]/renew — open the bank's consent again for the same connection,
 * answering the bank's URL. The connection keeps working as it is until the bank grants the new
 * consent; the callback then puts it in place (`completeConsent`).
 *
 * Another owner's connection is not found (404), as one that does not exist. A connection that
 * cannot be renewed is a 409 with a reason; typed errors reach `withErrorHandler`.
 */
async function handlePost(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const resolved = context?.params
    ? context.params instanceof Promise
      ? await context.params
      : context.params
    : undefined;
  const id = resolved?.id;
  if (!id) {
    return createErrorResponse(new Error("Connection id is required"), 400, request);
  }

  try {
    return createSuccessResponse(await startRenewal(scopeUserId, id));
  } catch (error) {
    if (error instanceof ConsentFlowError) {
      return createErrorResponse(error, error.status, request);
    }
    throw error;
  }
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
