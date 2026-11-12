import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { cadernetaDrafts, parseCaderneta } from "@/lib/services/financas-import/caderneta";
import { parseContract } from "@/lib/services/financas-import/contract";
import { parseContractForm } from "@/lib/services/financas-import/contract-form";
import { parseRentReceipt } from "@/lib/services/financas-import/rent-receipt";
import { readUploadedPdf } from "@/lib/services/financas-import/read-upload";
import { proposeReceipt } from "@/lib/services/receipts/financas-receipts";

/**
 * Reads a document downloaded from the Portal das Finanças, for the owner to confirm:
 * `?kind=caderneta` a caderneta predial urbana (the properties it describes), `?kind=contract` the
 * proof of a registered lease or the filled Modelo 2 form itself (its terms, parties and property),
 * `?kind=receipt` a recibo de renda (the contract and month it pays, and what uploading it would
 * do there).
 *
 * It writes nothing and keeps nothing: the answer goes back to the screen, which creates the
 * properties or the tenancy through their own routes once the owner has checked them, and puts a
 * recibo on the ledger through `POST /api/receipts/financas`. The body is the PDF itself, as for a
 * lease's contract (`app/api/leases/[id]/contract`).
 */

async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "caderneta" && kind !== "contract" && kind !== "receipt") {
    return createErrorResponse(new Error("Invalid request: kind"), 400, request);
  }

  const upload = await readUploadedPdf(request);
  if (upload instanceof Response) return upload;
  const { pages, items } = upload.pdf;

  if (kind === "caderneta") {
    const document = parseCaderneta(pages);
    return createSuccessResponse({ kind, document, drafts: cadernetaDrafts(document) });
  }
  if (kind === "receipt") {
    const receipt = parseRentReceipt(pages);
    const proposal = await proposeReceipt(authResult.scopeUserId, receipt);
    return createSuccessResponse({ kind, receipt, proposal });
  }
  // The filled Modelo 2 form is read by position; its comprovativo, as text.
  const contract = parseContractForm(items) ?? parseContract(pages);
  return createSuccessResponse({ kind, contract });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
