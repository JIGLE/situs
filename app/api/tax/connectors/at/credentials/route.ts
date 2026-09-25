import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  getAtConnection,
  removeAtCredentials,
  saveAtCredentials,
} from "@/lib/services/tax/at-connection";
import { atCredentialsSchema } from "@/lib/schemas/at-connection.schema";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * PUT /api/tax/connectors/at/credentials: store the Portal sub-user Situs signs in to AT as,
 * encrypted with the PII key. Without a password, the stored one is kept. Refused (409) when the
 * instance has no PII key: the password is never stored in clear.
 *
 * Answers with the connection view, which never includes the password.
 */
async function handlePut(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const input = await parseJsonBody(request, atCredentialsSchema);
  await saveAtCredentials(scopeUserId, input);
  return createSuccessResponse(await getAtConnection(scopeUserId));
}

/** DELETE /api/tax/connectors/at/credentials: forget the sub-user; a test mode goes back to review. */
async function handleDelete(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  await removeAtCredentials(scopeUserId);
  return createSuccessResponse(await getAtConnection(scopeUserId));
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
