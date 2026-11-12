import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { logAudit } from "@/lib/services/audit-log";
import { setRentCollector } from "@/lib/services/owner-payouts/service";
import { rentCollectorSchema } from "@/lib/schemas/owner-payout.schema";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

/**
 * Finance › Owners' shares: marks the owner who collects the rent, whose share is what they keep
 * rather than something to pay them. One owner collects; marking one unmarks the last.
 */
async function handlePut(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const { ownerId, collects } = await parseJsonBody(request, rentCollectorSchema);
  const owner = await setRentCollector(scopeUserId, ownerId, collects);

  await logAudit({
    userId: scopeUserId,
    action: "SET_RENT_COLLECTOR",
    resourceType: "Owner",
    resourceId: owner.id,
    details: { ownerName: owner.name, collects },
  });

  return createSuccessResponse({ ownerId: owner.id, collects });
}

export const PUT = withErrorHandler(withRateLimit(handlePut));
export const OPTIONS = handleOptions;
