import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { logAudit } from "@/lib/services/audit-log";
import { getOwnerPayoutYear, recordOwnerPayout } from "@/lib/services/owner-payouts/service";
import { ownerPayoutSchema } from "@/lib/schemas/owner-payout.schema";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * Finance › Owners' shares: a year's net rental income split between each property's owners, with what
 * has been paid out to each (`lib/services/owner-payouts/`). GET reads the year; POST records a
 * payout to one owner.
 */
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const yearParam = Number(new URL(request.url).searchParams.get("year"));
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
      ? yearParam
      : new Date().getUTCFullYear();

  return createSuccessResponse(await getOwnerPayoutYear(scopeUserId, year));
}

async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const body = await parseJsonBody(request, ownerPayoutSchema);
  const { payout, ownerName } = await recordOwnerPayout(scopeUserId, {
    ...body,
    paidAt: new Date(`${body.paidAt}T00:00:00.000Z`),
  });

  await logAudit({
    userId: scopeUserId,
    action: "RECORD_OWNER_PAYOUT",
    resourceType: "OwnerPayout",
    resourceId: payout.id,
    details: { ownerId: payout.ownerId, ownerName, year: payout.year, amount: payout.amount },
  });

  return createSuccessResponse(payout, 201);
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
