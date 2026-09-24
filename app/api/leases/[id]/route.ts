import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import { updateLeaseSchema } from "@/lib/schemas/lease.schema";

const leaseInclude = {
  property: { select: { name: true, address: true } },
  tenant: { select: { name: true, email: true } },
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

  const json = await request.json();

  // The lease's own terms, and only those the request sent. The body used to be spread into the
  // update whole, so a request could write any column — `userId` included, which moved the lease
  // into another account — and the renewal screen's round trip sent relation objects back.
  const body = parseBody(json, updateLeaseSchema);

  // The same check POST makes: a lease binds a tenant to a property and drives the rent ledger,
  // so re-pointing one at records the caller does not own writes into another landlord's books.
  await assertOwnsRelations(userId, {
    propertyId: body.propertyId,
    tenantId: body.tenantId,
    unitId: body.unitId,
  });

  const updateData: Record<string, unknown> = { ...body };

  if (body.startDate) updateData.startDate = new Date(body.startDate);
  if (body.endDate) updateData.endDate = new Date(body.endDate);

  // Read off the raw body, as POST does: the upload is not one of the lease's terms.
  if (json.contractFile) {
    const contractBuffer = Buffer.from(json.contractFile, "base64");
    updateData.contractFile = contractBuffer;
    updateData.contractFileSize = contractBuffer.length;
    updateData.contractFileName = `lease-contract-${Date.now()}.pdf`;
  }

  const lease = await prisma.lease.update({
    where: { id, userId },
    data: updateData,
    include: leaseInclude,
  });

  return createSuccessResponse(lease);
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

  await prisma.lease.delete({ where: { id, userId } });

  return createSuccessResponse({ message: "Lease deleted successfully" });
}

export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
