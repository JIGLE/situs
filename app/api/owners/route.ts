import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { ownerSchema } from "@/lib/schemas/owner.schema";
import { isMockMode } from "@/lib/config/data-mode";
import { createSuccessResponse, parseJsonBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";

async function handleGet(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse([]);
  }
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const owners = await prisma.owner.findMany({
    where: { userId },
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
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const body = await parseJsonBody(request, ownerSchema);

  const owner = await prisma.owner.create({
    data: {
      ...body,
      userId,
    },
  });

  return createSuccessResponse(owner, 201);
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
