import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import {
  propertyOwnerSchema,
  propertyOwnerDeleteSchema,
} from "@/lib/schemas/property-owner.schema";
import { isMockMode } from "@/lib/config/data-mode";
import {
  createSuccessResponse,
  withErrorHandler,
  parseBody,
  parseJsonBody,
  ValidationError,
  ResourceNotFoundError,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

/**
 * Assign and unassign owners on a property.
 *
 * This route is new, but its callers are not: `property-detail-view.tsx` has posted here since
 * 2026-07-19 (commit d5d01d9, the money-forward property detail). The route was never written, so
 * both calls 404'd and the panel showed "Failed to assign owner. Please try again." for what
 * looked like a data problem. A cross-reference of all 87 client API calls against the 139
 * implemented routes found this as the only such gap in the app.
 *
 */

/** Percentages are floats, so compare with a tolerance rather than exactly — matches the UI. */
const TOTAL_TOLERANCE = 0.001;

async function handlePost(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse({ error: "Write operations not supported in mock mode" }, 403);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const { propertyId, ownerId, ownershipPercentage, role } = await parseJsonBody(
    request,
    propertyOwnerSchema,
  );

  // Scope both sides to the caller. Without this, a valid session could attach any owner id to
  // any property id — the ids are cuids, but that is obscurity, not authorization.
  const [property, owner] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, userId }, select: { id: true } }),
    prisma.owner.findFirst({ where: { id: ownerId, userId }, select: { id: true, name: true } }),
  ]);

  if (!property) throw new ResourceNotFoundError("Property not found");
  if (!owner) throw new ResourceNotFoundError("Owner not found");

  // The client checks this too (property-detail-view.tsx:346), but a client-side check is a
  // convenience, not a constraint — the sum has to hold regardless of who is calling.
  // Re-assigning an existing owner replaces their share rather than adding to it, so their
  // current row is excluded from the total.
  const existing = await prisma.propertyOwner.findMany({
    where: { propertyId, ownerId: { not: ownerId } },
    select: { ownershipPercentage: true },
  });
  const othersTotal = existing.reduce((sum, row) => sum + row.ownershipPercentage, 0);

  if (othersTotal + ownershipPercentage > 100 + TOTAL_TOLERANCE) {
    throw new ValidationError(
      `Total ownership would be ${(othersTotal + ownershipPercentage).toFixed(1)}%, which exceeds 100%. ` +
        `${othersTotal.toFixed(1)}% is already assigned.`,
      "ownershipPercentage",
    );
  }

  // @@unique([propertyId, ownerId]) makes this idempotent: assigning an owner who is already on
  // the property updates their share instead of failing on the constraint.
  const assignment = await prisma.propertyOwner.upsert({
    where: { propertyId_ownerId: { propertyId, ownerId } },
    create: { propertyId, ownerId, ownershipPercentage, ...(role ? { role } : {}) },
    update: { ownershipPercentage, ...(role ? { role } : {}) },
  });

  await logAudit({
    userId,
    action: "ASSIGN_PROPERTY_OWNER",
    resourceType: "PropertyOwner",
    resourceId: assignment.id,
    details: {
      propertyId,
      ownerId,
      ownerName: owner.name,
      ownershipPercentage,
      totalAfter: othersTotal + ownershipPercentage,
    },
  });

  return createSuccessResponse(assignment, 201);
}

async function handleDelete(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse({ error: "Write operations not supported in mock mode" }, 403);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const url = new URL(request.url);
  const { propertyId, ownerId } = parseBody(
    {
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      ownerId: url.searchParams.get("ownerId") ?? undefined,
    },
    propertyOwnerDeleteSchema,
  );

  const property = await prisma.property.findFirst({
    where: { id: propertyId, userId },
    select: { id: true },
  });
  if (!property) throw new ResourceNotFoundError("Property not found");

  const assignment = await prisma.propertyOwner.findUnique({
    where: { propertyId_ownerId: { propertyId, ownerId } },
    select: { id: true, ownershipPercentage: true },
  });
  if (!assignment) throw new ResourceNotFoundError("That owner is not assigned to this property");

  await prisma.propertyOwner.delete({ where: { id: assignment.id } });

  await logAudit({
    userId,
    action: "REMOVE_PROPERTY_OWNER",
    resourceType: "PropertyOwner",
    resourceId: assignment.id,
    details: { propertyId, ownerId, ownershipPercentage: assignment.ownershipPercentage },
  });

  return createSuccessResponse({ propertyId, ownerId, removed: true });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
