import { NextRequest } from "next/server";

import { handleOptions, requireAdmin } from "@/lib/services/auth/auth-middleware";
import { allowedEmails } from "@/lib/services/auth/registration";
import { listAccounts } from "@/lib/services/auth/accounts";
import { getSignUpSettings, listInvitations } from "@/lib/services/auth/sign-up";
import { createSuccessResponse, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/admin/access — who may create an account and who has one: the two sign-up switches, the
 * invitations still held, the emails `AUTH_ALLOWED_EMAILS` adds, and the accounts with their roles.
 * Administrators only.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireAdmin(request);
  if (authResult instanceof Response) return authResult;

  const [settings, invitations, accounts] = await Promise.all([
    getSignUpSettings(),
    listInvitations(),
    listAccounts(authResult.userId),
  ]);
  return createSuccessResponse({ settings, invitations, allowlist: allowedEmails(), accounts });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
