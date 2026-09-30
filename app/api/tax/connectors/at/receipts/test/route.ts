import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { testAtReceipts } from "@/lib/services/tax/at-receipts";
import { atReceiptsTestSchema } from "@/lib/schemas/at-connection.schema";
import {
  createSuccessResponse,
  parseBody,
  withErrorHandler,
  readJson,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/tax/connectors/at/receipts/test: sends each ready month of the chosen receipts to AT's
 * test service and answers with what AT said. Nothing is recorded on the receipts: AT's test
 * service issues receipts that do not count. Needs the test mode, a stored login and the
 * certificate files; a 409 names what is missing.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const raw: unknown = await readJson(request);
  const { receiptIds } = parseBody(raw, atReceiptsTestSchema);
  const receipts = await testAtReceipts(authResult.scopeUserId, receiptIds);
  return createSuccessResponse({ receipts });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
