import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { buildingSchema } from "@/lib/schemas/building.schema";
import { isMockMode } from "@/lib/config/data-mode";
import { ZodError } from "zod";

async function handleGet(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse([]);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const buildings = await prisma.building.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { properties: true } },
    },
  });

  return createSuccessResponse(
    buildings.map((b) => ({ ...b, propertyCount: b._count.properties })),
  );
}

async function handlePost(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createErrorResponse(
      new Error("Write operations not supported in mock mode"),
      403,
      request,
    );
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  try {
    const json = await request.json();
    const body = buildingSchema.parse(json);

    const building = await prisma.building.create({
      data: { ...body, userId },
      include: { _count: { select: { properties: true } } },
    });

    return createSuccessResponse({ ...building, propertyCount: building._count.properties }, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return createErrorResponse(
        new Error(`Validation error: ${error.issues.map((e) => e.message).join(", ")}`),
        400,
        request,
      );
    }
    return createErrorResponse(error as Error, 500, request);
  }
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
