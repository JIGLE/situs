import { NextRequest } from "next/server";
import { handleOptions, requireAuth } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { documentService } from "@/lib/services/document-service";

/** A PDF, or the JPEG the phone makes of a photo. */
const INVOICE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/expenses/invoice?name=…&propertyId=… — keeps an invoice the owner confirmed, as an
 * `invoice` Document, and answers its id for the expense's `documentId`. The form sends it only
 * when the expense is saved, so an invoice read and then dismissed leaves nothing behind. The body
 * is the file itself; 413 too large, 415 neither a PDF nor an image.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const mimeType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!INVOICE_TYPES.has(mimeType)) {
    return createErrorResponse(new Error("Not an invoice file"), 415, request);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_INVOICE_BYTES) {
    return createErrorResponse(new Error("File too large"), 413, request);
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length === 0) return createErrorResponse(new Error("Empty file"), 400, request);
  if (bytes.length > MAX_INVOICE_BYTES) {
    return createErrorResponse(new Error("File too large"), 413, request);
  }

  const query = new URL(request.url).searchParams;
  const name = (query.get("name") ?? "fatura").slice(0, 200) || "fatura";
  // The property is checked as the caller's by the service, before the file is written.
  const document = await documentService.create(authResult.userId, {
    name,
    type: "invoice",
    mimeType,
    fileContent: bytes,
    propertyId: query.get("propertyId") || undefined,
  });
  return createSuccessResponse({ id: document.id, name: document.name }, 201);
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
