import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { runAtCheck } from "@/lib/services/tax/at-connection";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/tax/connectors/at/check: Check credentials against AT's test service. Asks for a
 * receipt that cannot exist, so AT creates nothing; its answer says whether the certificate, the
 * key files and the sub-user were accepted. Needs the test mode (409 otherwise).
 *
 * AT's answer is the body, whatever it was: a refused password is a result to show, not an error
 * of this route.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  return createSuccessResponse(await runAtCheck(authResult.scopeUserId));
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
