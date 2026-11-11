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
import { dayOf, lastChangeOf, type ShareSpan } from "@/lib/services/database/ownership";

/**
 * Assign and unassign owners on a property.
 *
 * This route is new, but its callers are not: `property-detail-view.tsx` has posted here since
 * 2026-07-19 (commit d5d01d9, the money-forward property detail). The route was never written, so
 * both calls 404'd and the panel showed "Failed to assign owner. Please try again." for what
 * looked like a data problem. A cross-reference of all 87 client API calls against the 139
 * implemented routes found this as the only such gap in the app.
 *
 * Shares are dated (`lib/services/database/ownership.ts`): assigning a different share closes the
 * owner's current row and opens a new one, and removing an owner closes their row on the day they
 * stopped owning the property, so who owned it before stays on record.
 */

/** Percentages are floats, so compare with a tolerance rather than exactly — matches the UI. */
const TOTAL_TOLERANCE = 0.001;

/**
 * A change takes effect no later than today, and no earlier than the property's last change:
 * shares are a timeline appended at its end, so the shares in force on any day stay one set.
 */
function refuseOutOfOrder(rows: ShareSpan[], day: Date, field: string): void {
  if (day > dayOf(new Date())) {
    throw new ValidationError("A change of ownership cannot take effect in the future", field);
  }
  const last = lastChangeOf(rows);
  if (last && day < last) {
    throw new ValidationError(
      `This property's ownership last changed on ${last.toISOString().slice(0, 10)}; a new change cannot take effect before it`,
      field,
    );
  }
}

async function handlePost(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse({ error: "Write operations not supported in mock mode" }, 403);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const { propertyId, ownerId, ownershipPercentage, role, effectiveFrom } = await parseJsonBody(
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

  const day = dayOf(effectiveFrom ?? new Date());
  const { assignment, othersTotal } = await prisma.$transaction(async (tx) => {
    const rows = await tx.propertyOwner.findMany({
      where: { propertyId },
      select: {
        id: true,
        ownerId: true,
        ownershipPercentage: true,
        validFrom: true,
        validTo: true,
      },
    });
    refuseOutOfOrder(rows, day, "effectiveFrom");

    // The client checks this too, but a client-side check is a convenience, not a constraint: the
    // shares in force from `day` have to add up regardless of who is calling. Re-assigning an
    // owner replaces their share rather than adding to it, so their own row is left out.
    const current = rows.filter((row) => row.validTo === null);
    const othersTotal = current
      .filter((row) => row.ownerId !== ownerId)
      .reduce((sum, row) => sum + row.ownershipPercentage, 0);
    if (othersTotal + ownershipPercentage > 100 + TOTAL_TOLERANCE) {
      throw new ValidationError(
        `Total ownership would be ${(othersTotal + ownershipPercentage).toFixed(1)}%, which exceeds 100%. ` +
          `${othersTotal.toFixed(1)}% is already assigned.`,
        "ownershipPercentage",
      );
    }

    const mine = current.find((row) => row.ownerId === ownerId);
    // The same share, or a share that starts on the same day: a correction, made in place.
    if (
      mine &&
      (Math.abs(mine.ownershipPercentage - ownershipPercentage) < TOTAL_TOLERANCE ||
        (mine.validFrom !== null && mine.validFrom.getTime() === day.getTime()))
    ) {
      const assignment = await tx.propertyOwner.update({
        where: { id: mine.id },
        data: { ownershipPercentage, ...(role ? { role } : {}) },
      });
      return { assignment, othersTotal };
    }
    // A new share: the old one, if any, ends the day this one starts.
    if (mine) await tx.propertyOwner.update({ where: { id: mine.id }, data: { validTo: day } });
    const assignment = await tx.propertyOwner.create({
      data: {
        propertyId,
        ownerId,
        ownershipPercentage,
        // An owner's first share on a property, given no date, holds from the beginning.
        validFrom: mine || effectiveFrom ? day : null,
        ...(role ? { role } : {}),
      },
    });
    return { assignment, othersTotal };
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
      effectiveFrom: assignment.validFrom?.toISOString().slice(0, 10) ?? null,
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
  const { propertyId, ownerId, effectiveTo } = parseBody(
    {
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      ownerId: url.searchParams.get("ownerId") ?? undefined,
      effectiveTo: url.searchParams.get("effectiveTo") ?? undefined,
    },
    propertyOwnerDeleteSchema,
  );

  const property = await prisma.property.findFirst({
    where: { id: propertyId, userId },
    select: { id: true },
  });
  if (!property) throw new ResourceNotFoundError("Property not found");

  const day = dayOf(effectiveTo ?? new Date());
  const { assignment, removed } = await prisma.$transaction(async (tx) => {
    const rows = await tx.propertyOwner.findMany({
      where: { propertyId },
      select: {
        id: true,
        ownerId: true,
        ownershipPercentage: true,
        validFrom: true,
        validTo: true,
        createdAt: true,
      },
    });
    const assignment = rows.find((row) => row.ownerId === ownerId && row.validTo === null);
    if (!assignment) {
      throw new ResourceNotFoundError("That owner is not assigned to this property");
    }
    refuseOutOfOrder(rows, day, "effectiveTo");

    // A share that would end the day it began never held: it goes, and so does one entered today
    // and taken off today, a mistake rather than history. Any other ends on `day`, and stays as
    // the record of who owned the property until then.
    const began = assignment.validFrom ?? dayOf(assignment.createdAt);
    if (began.getTime() === day.getTime()) {
      await tx.propertyOwner.delete({ where: { id: assignment.id } });
      return { assignment, removed: true };
    }
    await tx.propertyOwner.update({ where: { id: assignment.id }, data: { validTo: day } });
    return { assignment, removed: false };
  });

  await logAudit({
    userId,
    action: "REMOVE_PROPERTY_OWNER",
    resourceType: "PropertyOwner",
    resourceId: assignment.id,
    details: {
      propertyId,
      ownerId,
      ownershipPercentage: assignment.ownershipPercentage,
      endedOn: removed ? null : day.toISOString().slice(0, 10),
    },
  });

  return createSuccessResponse({
    propertyId,
    ownerId,
    removed: true,
    endedOn: removed ? null : day.toISOString().slice(0, 10),
  });
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const DELETE = withErrorHandler(withRateLimit(handleDelete));
export const OPTIONS = handleOptions;
