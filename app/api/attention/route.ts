import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getAttention } from "@/lib/services/attention/gather";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/attention — what the owner still has to give Situs before a receipt can go to Finanças:
 * the fields missing on their active leases, their tenants and their landlords, most important
 * first, with a count (`lib/services/attention/`). Every item is the owner's own.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  return createSuccessResponse(await getAttention(authResult.scopeUserId));
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
