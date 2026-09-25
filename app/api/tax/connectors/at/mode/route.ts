import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getAtConnection, setAtMode } from "@/lib/services/tax/at-connection";
import { atModeSchema } from "@/lib/schemas/at-connection.schema";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * PUT /api/tax/connectors/at/mode: sandbox, review or test. `live` is not accepted: going live is
 * a code change. The test mode is refused (409, with the reason) until the certificate files read
 * and a sub-user is stored.
 */
async function handlePut(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const { mode } = await parseJsonBody(request, atModeSchema);
  await setAtMode(scopeUserId, mode);
  return createSuccessResponse(await getAtConnection(scopeUserId));
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
