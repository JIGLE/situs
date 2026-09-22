import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { findExistingArchive } from "@/lib/services/receipts/service";

export const runtime = "nodejs";

/**
 * GET /api/receipts/[id]/archive — the id of this receipt's archived PDF, or 404.
 *
 * Resolution only. The bytes come from `/api/documents/[id]/download`, which already handles
 * streaming, filename sanitisation and portal scoping; duplicating that here would be a second
 * copy of security-relevant code for no gain.
 *
 * 404 is a real answer, not an error: a receipt archives its PDF on reaching emitted/accepted,
 * so a draft legitimately has none. The caller falls back to rendering one client-side.
 */
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  let id: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const documentId = await findExistingArchive(scopeUserId, id);
  if (!documentId) {
    return createErrorResponse(new Error("No archived PDF for this receipt"), 404, request);
  }

  return createSuccessResponse({ documentId });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
