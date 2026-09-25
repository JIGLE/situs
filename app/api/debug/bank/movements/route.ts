import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { debugBankMovementsSchema } from "@/lib/schemas/bank.schema";
import { importBankRows } from "@/lib/services/bank/import";

export const runtime = "nodejs";

/**
 * POST /api/debug/bank/movements: put bank movements through the import pipeline, in development
 * and E2E only.
 *
 * A live bank connection is the one way movements reach an instance; the CSV import that used to
 * be the other was removed. The E2E suite still needs movements it controls, and a real bank
 * cannot be reached from CI, so this takes JSON rows and runs the same `importBankRows` a sync
 * does: fingerprint dedupe, matching, allocation. Open only where `/api/debug/db/seed` is — in
 * development or with ALLOW_DEMO_MODE=true — and 403 everywhere else.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const isDev = process.env.NODE_ENV === "development";
  const allowDemoMode = process.env.ALLOW_DEMO_MODE === "true";
  if (!isDev && !allowDemoMode) {
    return createErrorResponse(new Error("Debug import disabled in this environment"), 403);
  }

  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { rows } = parseBody(await request.json(), debugBankMovementsSchema);
  const summary = await importBankRows(authResult.scopeUserId, rows, "manual_entry");
  return createSuccessResponse(summary, 201);
}

export const POST = withErrorHandler(handlePost);
export const OPTIONS = handleOptions;
