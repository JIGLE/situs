import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { logAudit } from "@/lib/services/audit-log";
import { deleteOwnerPayout } from "@/lib/services/owner-payouts/service";
import {
  ValidationError,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

type Context = { params?: Record<string, string> | Promise<Record<string, string>> };

/** Removes a payout recorded by mistake; the audit trail keeps what it was. */
async function handleDelete(request: NextRequest, context?: Context): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  if (!params?.id) throw new ValidationError("Invalid request: missing id");

  const payout = await deleteOwnerPayout(scopeUserId, params.id);
  await logAudit({
    userId: scopeUserId,
    action: "DELETE_OWNER_PAYOUT",
    resourceType: "OwnerPayout",
    resourceId: payout.id,
    details: {
      ownerId: payout.ownerId,
      year: payout.year,
      amount: payout.amount,
      paidAt: payout.paidAt.toISOString().slice(0, 10),
    },
  });

  return createSuccessResponse({ id: payout.id });
}

export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
