import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { forgetPayerAccount } from "@/lib/services/bank/payer-accounts";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

// DELETE /api/tenants/[id]/payer-accounts/[accountId] — the owner forgets an account: its payments
// wait for them again. An account that is not there, is another tenant's or another owner's is one
// 404, so the answer says nothing about which.
async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  const tenantId = params?.id;
  const accountId = params?.accountId;
  if (!tenantId || !accountId) {
    return createErrorResponse(new Error("Invalid request: missing id"), 400, request);
  }

  await forgetPayerAccount(scopeUserId, tenantId, accountId);
  return createSuccessResponse({ forgotten: true });
}

export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
