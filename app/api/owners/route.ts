import { NextRequest } from "next/server";
import { requireOwnerAccess, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { ownerSchema } from "@/lib/schemas/owner.schema";
import { normalizeTaxId } from "@/lib/schemas/tax-identity";
import { isMockMode } from "@/lib/config/data-mode";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

async function handleGet(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse([]);
  }
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;
  const prisma = getPrismaClient();

  const owners = await prisma.owner.findMany({
    where: { userId: scopeUserId },
    orderBy: { createdAt: "desc" },
    include: {
      properties: {
        include: {
          property: true,
        },
      },
    },
  });

  return createSuccessResponse(owners);
}

async function handlePost(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse({ error: "Write operations not supported in mock mode" }, 403);
  }
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;
  const prisma = getPrismaClient();

  const body = await parseJsonBody(request, ownerSchema);

  const owner = await prisma.owner.create({
    data: {
      ...body,
      // Stored as its nine digits, as a tenant's is.
      taxIdentificationNumber: normalizeTaxId(body.taxIdentificationNumber, "PT"),
      userId: scopeUserId,
    },
  });

  return createSuccessResponse(owner, 201);
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
