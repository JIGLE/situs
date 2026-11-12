import { NextRequest } from "next/server";
import { z } from "zod";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, parseBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { parseRentReceipt } from "@/lib/services/financas-import/rent-receipt";
import { readUploadedPdf } from "@/lib/services/financas-import/read-upload";
import { registerReceipt } from "@/lib/services/receipts/financas-receipts";

export const runtime = "nodejs";

const querySchema = z.object({
  leaseId: z.string().min(1).max(64),
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  name: z.string().max(200),
});

/**
 * POST /api/receipts/financas?leaseId=&month=YYYY-MM&name= — put an uploaded recibo de renda on
 * the ledger, for the contract and month the owner confirmed. The body is the PDF; it is read again
 * here rather than trusted from the screen, so the amount, dates and number are the recibo's own.
 * Answers what it did: `create` (the recibo paid the month), `attach` (a payment already there
 * took its number) or `duplicate` (already on file).
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const params = new URL(request.url).searchParams;
  const query = parseBody(
    {
      leaseId: params.get("leaseId") ?? "",
      month: params.get("month") ?? "",
      name: params.get("name") ?? "",
    },
    querySchema,
  );

  const upload = await readUploadedPdf(request);
  if (upload instanceof Response) return upload;

  const [year, month] = query.month.split("-").map(Number);
  const result = await registerReceipt(scopeUserId, {
    leaseId: query.leaseId,
    month: { year, month },
    parsed: parseRentReceipt(upload.pdf.pages),
    pdf: upload.bytes,
    fileName: query.name,
  });
  return createSuccessResponse(result);
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
