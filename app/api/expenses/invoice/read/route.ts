import { NextRequest } from "next/server";
import { handleOptions, requireAuth } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { readUploadedPdf } from "@/lib/services/financas-import/read-upload";
import { readInvoiceText } from "@/lib/utils/invoice-read";

/**
 * POST /api/expenses/invoice/read — what a PDF invoice says (supplier NIF, day, total), for the
 * expense form to fill in and the owner to check. It writes and keeps nothing; a photo's QR code
 * is read on the phone instead (`components/features/financial/invoice-reader.ts`). The body is
 * the PDF itself: 413 too large, 415 not a PDF, 422 unreadable or a scan with no text.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const upload = await readUploadedPdf(request);
  if (upload instanceof Response) return upload;
  return createSuccessResponse(readInvoiceText(upload.pdf.pages));
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
