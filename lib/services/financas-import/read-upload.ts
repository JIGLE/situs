import type { NextRequest } from "next/server";

import { createErrorResponse } from "@/lib/utils/error-handling";
import { MAX_CONTRACT_BYTES } from "@/lib/utils/contract-file";
import { readPdf, type PdfContent } from "./pdf-text";

const PDF_SIGNATURE = Buffer.from("%PDF-");

/**
 * The PDF a request carries as its body, read: its bytes and its text. A refusal is the Response
 * to answer with: 413 too large, 415 not a PDF, 422 unreadable or a scan with no text.
 */
export async function readUploadedPdf(
  request: NextRequest,
): Promise<{ bytes: Buffer; pdf: PdfContent } | Response> {
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
  let pdf: PdfContent;
  try {
    pdf = await readPdf(new Uint8Array(bytes));
  } catch {
    return createErrorResponse(new Error("Unreadable PDF"), 422, request);
  }
  // A scan has no text to read.
  if (pdf.pages.join("").trim().length < 40) {
    return createErrorResponse(new Error("PDF has no text"), 422, request);
  }
  return { bytes, pdf };
}
