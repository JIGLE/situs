import { NextRequest } from "next/server";
import { getAccessContext, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";

async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await getAccessContext(request);
  if (authResult instanceof Response) return authResult;

  const { portalRole, tenantId, scopeUserId } = authResult;

  // Only meaningful for tenant sessions
  if (portalRole !== "tenant" || !tenantId) {
    return createErrorResponse(new Error("Tenant session required"), 403, request);
  }

  const prisma = getPrismaClient();

  // Find an active lease for this tenant to get the propertyId
  const lease = await prisma.lease.findFirst({
    where: { tenantId, userId: scopeUserId, status: "active" },
    select: { propertyId: true },
  });

  if (!lease) {
    return createErrorResponse(new Error("No active lease found"), 404, request);
  }

  // Find the managing owner (prefer MANAGING role, else first owner)
  const propertyOwners = await prisma.propertyOwner.findMany({
    where: { propertyId: lease.propertyId },
    include: { owner: true },
  });

  if (propertyOwners.length === 0) {
    return createErrorResponse(new Error("No owner found for property"), 404, request);
  }

  const po = propertyOwners.find((p) => p.role === "MANAGING") ?? propertyOwners[0];

  return createSuccessResponse({
    name: po.owner.name,
    email: po.owner.email,
    phone: po.owner.phone ?? undefined,
  });
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const OPTIONS = handleOptions;
