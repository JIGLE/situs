import { NextRequest } from "next/server";

import { handleOptions, requireAdmin } from "@/lib/services/auth/auth-middleware";
import { changeAccountRole } from "@/lib/services/auth/accounts";
import { accountRoleSchema } from "@/lib/schemas/admin-access.schema";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  readJson,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * PUT /api/admin/access/accounts/[id] — an account's role, and nothing else about it. Administrator or
 * manager. The only administrator cannot be demoted (409 `last_admin`); an account that is not there
 * is a 404; the role it already has is no change.
 */
async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  const id = params?.id;
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const body = parseBody(await readJson(request), accountRoleSchema);
  return createSuccessResponse(await changeAccountRole(authResult.userId, id, body.role));
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
