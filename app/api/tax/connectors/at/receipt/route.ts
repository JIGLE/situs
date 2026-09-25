import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { fetchAtReceipt } from "@/lib/services/tax/at-connection";
import { atReceiptSchema } from "@/lib/schemas/at-connection.schema";
import { createSuccessResponse, parseBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/tax/connectors/at/receipt: one receipt AT issued, fetched from AT's test service as
 * its PDF, for the owner to download. Nothing is stored. Needs the test mode (409 otherwise).
 *
 * The PDF travels as Base64 inside the usual envelope, beside AT's answer, so a refusal and a
 * receipt reach the screen the same way.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { contractNumber, receiptNumber } = parseBody(await request.json(), atReceiptSchema);
  const { call, pdf } = await fetchAtReceipt(authResult.scopeUserId, contractNumber, receiptNumber);
  return createSuccessResponse({ call, ...(pdf ? { pdf: pdf.toString("base64") } : {}) });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
