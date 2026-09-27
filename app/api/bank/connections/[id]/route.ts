import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  ValidationError,
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { bankConnectionRenameSchema } from "@/lib/schemas/bank.schema";
import { renameConnection } from "@/lib/services/bank/connections";

export const runtime = "nodejs";

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

async function connectionId(context?: Context): Promise<string | undefined> {
  const resolved = context?.params
    ? context.params instanceof Promise
      ? await context.params
      : context.params
    : undefined;
  return resolved?.id;
}

/**
 * PATCH /api/bank/connections/[id] — the owner's own name for a connection: `{ label }`, 60
 * characters at most. Empty, or null, goes back to the bank's name.
 *
 * Another owner's connection is not found (404), as one that does not exist.
 */
async function handlePatch(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const id = await connectionId(context);
  if (!id) {
    return createErrorResponse(new Error("Connection id is required"), 400, request);
  }

  // A body that is not JSON is the caller's mistake, not the server's.
  const raw: unknown = await request.json().catch(() => {
    throw new ValidationError("Invalid request: the body is not JSON");
  });
  const { label } = parseBody(raw, bankConnectionRenameSchema);

  return createSuccessResponse(await renameConnection(scopeUserId, id, label));
}

export const PATCH = withErrorHandler(withRateLimit(handlePatch));
export const OPTIONS = handleOptions;
