import { NextRequest } from "next/server";

import { handleOptions, requireAdmin } from "@/lib/services/auth/auth-middleware";
import { allowedEmails } from "@/lib/services/auth/registration";
import { getSignUpSettings, listInvitations } from "@/lib/services/auth/sign-up";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/admin/access — who may create an account: the two sign-up switches, the invitations
 * still held, and the emails `AUTH_ALLOWED_EMAILS` adds. Administrators only.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const [settings, invitations] = await Promise.all([getSignUpSettings(), listInvitations()]);
  return createSuccessResponse({ settings, invitations, allowlist: allowedEmails() });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
