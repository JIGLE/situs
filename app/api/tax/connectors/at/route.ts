import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getAtConnection } from "@/lib/services/tax/at-connection";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/tax/connectors/at: the owner's AT connection for Settings › Integrations. The mode, the
 * sub-user's username, whether a password is stored (never the password), and the state of the
 * instance's three certificate files. Reads only; the connector row is created by the first write.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  return createSuccessResponse(await getAtConnection(authResult.scopeUserId));
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
