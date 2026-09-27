import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { disconnectConnection } from "@/lib/services/bank/connections";

export const runtime = "nodejs";

/**
 * POST /api/bank/connections/[id]/disconnect — stop a bank connection syncing, and ask the bank
 * to end its access. Answers how asking the bank went (`revocation`), so the screen can say
 * whether the bank was told. The accounts and their movements stay.
 *
 * Another owner's connection is not found (404), as one that does not exist. A connection that
 * cannot be disconnected, or changed while this ran, is a 409 with a reason; typed errors reach
 * `withErrorHandler`.
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

  return createSuccessResponse(await disconnectConnection(scopeUserId, id));
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
