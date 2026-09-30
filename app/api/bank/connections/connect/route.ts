import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
  readJson,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { bankConnectSchema } from "@/lib/schemas/bank.schema";
import { startConsent, ConsentFlowError } from "@/lib/services/bank/consent";

export const runtime = "nodejs";

// POST /api/bank/connections/connect — begin a live bank connection, returning the bank's URL.
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const body = parseBody(await readJson(request), bankConnectSchema);

  try {
    const { connectionId, url } = await startConsent(scopeUserId, body);
    return createSuccessResponse({ connectionId, url });
  } catch (error) {
    if (error instanceof ConsentFlowError) {
      return createErrorResponse(error, error.status, request);
    }
    throw error;
  }
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
