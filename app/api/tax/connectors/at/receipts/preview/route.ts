import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { previewAtReceipts } from "@/lib/services/tax/at-receipts";
import { atReceiptsPreviewSchema } from "@/lib/schemas/at-connection.schema";
import {
  ValidationError,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/tax/connectors/at/receipts/preview: for each chosen receipt, what AT would receive for
 * every rent month it pays, and what stops each. Reads only, in any mode, and only the owner's own
 * receipts: another owner's id is left out of the answer, as one that does not exist is.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  // A body that is not JSON is the caller's mistake, never a server error.
  const raw: unknown = await request.json().catch(() => {
    throw new ValidationError("Invalid request: the body is not JSON");
  });
  const { receiptIds } = parseBody(raw, atReceiptsPreviewSchema);
  return createSuccessResponse(await previewAtReceipts(authResult.scopeUserId, receiptIds));
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
