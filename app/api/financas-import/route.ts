import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { MAX_CONTRACT_BYTES } from "@/lib/utils/contract-file";
import { cadernetaDrafts, parseCaderneta } from "@/lib/services/financas-import/caderneta";
import { parseContract } from "@/lib/services/financas-import/contract";
import { pdfPages } from "@/lib/services/financas-import/pdf-text";

/**
 * Reads a document downloaded from the Portal das Finanças, for the owner to confirm:
 * `?kind=caderneta` a caderneta predial urbana (the properties it describes), `?kind=contract` the
 * proof of a registered lease (its terms, parties and property).
 *
 * It writes nothing and keeps nothing: the answer goes back to the screen, which creates the
 * properties or the tenancy through their own routes once the owner has checked them. The body is
 * the PDF itself, as for a lease's contract (`app/api/leases/[id]/contract`).
 */

const PDF_SIGNATURE = Buffer.from("%PDF-");

async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "caderneta" && kind !== "contract") {
    return createErrorResponse(new Error("Invalid request: kind"), 400, request);
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_CONTRACT_BYTES) {
    return createErrorResponse(new Error("File too large"), 413, request);
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_CONTRACT_BYTES) {
    return createErrorResponse(new Error("File too large"), 413, request);
  }
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return createErrorResponse(new Error("Not a PDF"), 415, request);
  }

  let pages: string[];
  try {
    pages = await pdfPages(new Uint8Array(bytes));
  } catch {
    return createErrorResponse(new Error("Unreadable PDF"), 422, request);
  }
  // A scan has no text to read.
  if (pages.join("").trim().length < 40) {
    return createErrorResponse(new Error("PDF has no text"), 422, request);
  }

  if (kind === "caderneta") {
    const document = parseCaderneta(pages);
    return createSuccessResponse({ kind, document, drafts: cadernetaDrafts(document) });
  }
  return createSuccessResponse({ kind, contract: parseContract(pages) });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
