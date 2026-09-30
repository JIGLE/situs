import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
  readJson,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { bankConnectionRenameSchema } from "@/lib/schemas/bank.schema";
import { removeConnection, renameConnection } from "@/lib/services/bank/connections";

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

  const raw: unknown = await readJson(request);
  const { label } = parseBody(raw, bankConnectionRenameSchema);

  return createSuccessResponse(await renameConnection(scopeUserId, id, label));
}

/**
 * DELETE /api/bank/connections/[id] — remove a connection that brought no movements, ending at
 * the bank any consent it held. One with movements is a 409 `bank_connection_has_movements`: its
 * movements are the owner's records, and disconnecting it keeps them.
 */
async function handleDelete(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const id = await connectionId(context);
  if (!id) {
    return createErrorResponse(new Error("Connection id is required"), 400, request);
  }

  return createSuccessResponse(await removeConnection(scopeUserId, id));
}

export const PATCH = withErrorHandler(withRateLimit(handlePatch));
export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
