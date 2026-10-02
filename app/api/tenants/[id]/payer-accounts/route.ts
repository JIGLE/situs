import { NextRequest } from "next/server";

import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { payerAccountsFor } from "@/lib/services/bank/payer-accounts";
import {
  ResourceNotFoundError,
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

export const runtime = "nodejs";

// GET /api/tenants/[id]/payer-accounts — the accounts the owner confirmed pay this tenant's rent,
// for the tenant's Payments tab. Another owner's tenant reads exactly as one that does not exist.
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;
  const { scopeUserId } = authResult;

  const params = context?.params instanceof Promise ? await context.params : context?.params;
  const tenantId = params?.id;
  if (!tenantId) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const tenant = await getPrismaClient().tenant.findFirst({
    where: { id: tenantId, userId: scopeUserId },
    select: { id: true },
  });
  if (!tenant) throw new ResourceNotFoundError("Tenant");

  return createSuccessResponse(await payerAccountsFor(scopeUserId, tenantId));
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
