import { NextRequest } from "next/server";

import { handleOptions, requireAdmin } from "@/lib/services/auth/auth-middleware";
import { revokeInvitation } from "@/lib/services/auth/sign-up";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

// DELETE /api/admin/access/invitations/[id] — withdraw an invitation. One that is not there is a 404.
async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  const id = params?.id;
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  await revokeInvitation(authResult.userId, id);
  return createSuccessResponse({ revoked: true });
}

export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
