import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  ConflictError,
  ResourceNotFoundError,
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
  readJson,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import { assertLeaseHasNoHistory } from "@/lib/services/database/history";
import { partiesByLease, replaceLeaseParties } from "@/lib/services/database/lease-parties";
import { updateLeaseSchema } from "@/lib/schemas/lease.schema";
import { auditLeasePeriodSync, syncLeasePeriods } from "@/lib/services/allocation/service";

const leaseInclude = {
  property: { select: { name: true, address: true } },
  tenant: { select: { name: true, email: true } },
  // The rent's history and any increase still to start, oldest first.
  rentIncreases: { orderBy: { effectiveFrom: "asc" as const } },
};

async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  let id: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const json = await readJson(request);

  // The lease's own terms, and only those the request sent. The body used to be spread into the
  // update whole, so a request could write any column — `userId` included, which moved the lease
  // into another account — and the renewal screen's round trip sent relation objects back.
  const { parties, ...body } = parseBody(json, updateLeaseSchema);

  // The same check POST makes: a lease binds a tenant to a property and drives the rent ledger,
  // so re-pointing one at records the caller does not own writes into another landlord's books.
  await assertOwnsRelations(userId, {
    propertyId: body.propertyId,
    tenantId: body.tenantId,
  });

  const updateData: Record<string, unknown> = { ...body };

  if (body.startDate) updateData.startDate = new Date(body.startDate);
  if (body.endDate) updateData.endDate = new Date(body.endDate);
  if (body.atContractNumber !== undefined) {
    updateData.atContractNumber = body.atContractNumber || null;
  }

  // The contract PDF is replaced through /api/leases/[id]/contract, not here.
  const leaseId = id;
  const { lease, sync } = await prisma.$transaction(async (tx) => {
    // First, so a lease the caller does not own fails before anything is touched.
    const current = await tx.lease.findFirst({
      where: { id: leaseId, userId },
      select: { tenantId: true, propertyId: true },
    });
    if (!current) throw new ResourceNotFoundError("Lease");

    // Who pays and for which property are what the lease's rent months were written for. Once
    // money is allocated to them, moving the lease to another tenant or property would leave
    // those payments on months that now name someone else. With nothing paid, the months follow.
    const movesTenant = body.tenantId !== undefined && body.tenantId !== current.tenantId;
    const movesProperty = body.propertyId !== undefined && body.propertyId !== current.propertyId;
    if (movesTenant || movesProperty) {
      const paid = await tx.paymentAllocation.count({
        where: { reversedAt: null, rentPeriod: { leaseId } },
      });
      if (paid > 0) {
        throw new ConflictError(
          "Payments are allocated to this lease, so its tenant and property cannot change",
          "lease_has_payments",
        );
      }
      await tx.rentPeriod.updateMany({
        where: { leaseId },
        data: {
          ...(movesTenant ? { tenantId: body.tenantId } : {}),
          ...(movesProperty ? { propertyId: body.propertyId } : {}),
        },
      });
    }

    const updated = await tx.lease.update({
      where: { id: leaseId, userId },
      data: updateData,
      include: leaseInclude,
    });
    if (parties) await replaceLeaseParties(tx, userId, leaseId, parties);
    // Dates, rent and status decide which months are owed: keep the ledger in step with them.
    const sync = await syncLeasePeriods(leaseId, tx);
    return { lease: updated, sync };
  });
  await auditLeasePeriodSync(userId, id, sync);

  const saved = await partiesByLease(userId, [id]);
  return createSuccessResponse({ ...lease, parties: saved.get(id) ?? [] });
}

async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  let id: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  // Refused while money is recorded against it; its rent months alone go with it.
  await assertLeaseHasNoHistory(userId, id);
  await prisma.lease.delete({ where: { id, userId } });

  return createSuccessResponse({ message: "Lease deleted successfully" });
}

export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
