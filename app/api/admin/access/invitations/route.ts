import { NextRequest } from "next/server";

import { handleOptions, requireAdmin } from "@/lib/services/auth/auth-middleware";
import { createInvitation } from "@/lib/services/auth/sign-up";
import { invitationSchema } from "@/lib/schemas/admin-access.schema";
import {
  createSuccessResponse,
  parseBody,
  readJson,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/admin/access/invitations — invite an email to create an account, as an administrator or
 * a manager. It admits nobody by itself: the person signs in with Google, and the gate finds it.
 * An email that already has an account is a 409 `account_exists`; one already invited is renewed.
 */
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const body = parseBody(await readJson(request), invitationSchema);
  const invitation = await createInvitation(authResult.userId, body);
  return createSuccessResponse(invitation, 201);
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
