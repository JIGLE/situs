import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
  readJson,
  parseBody,
} from "@/lib/utils/error-handling";
import { getPrismaClient } from "@/lib/services/database/database";
import { buildingSchema } from "@/lib/schemas/building.schema";

async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  let id: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const existing = await prisma.building.findFirst({ where: { id, userId } });
  if (!existing) return createErrorResponse(new Error("Building not found"), 404, request);

  const body = parseBody(await readJson(request), buildingSchema.partial());

  const building = await prisma.building.update({
    where: { id },
    data: body,
    include: { _count: { select: { properties: true } } },
  });

  return createSuccessResponse({ ...building, propertyCount: building._count.properties });
}

async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  let id: string | undefined;
  if (context?.params) {
    const resolved = context.params instanceof Promise ? await context.params : context.params;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  const existing = await prisma.building.findFirst({ where: { id, userId } });
  if (!existing) return createErrorResponse(new Error("Building not found"), 404, request);

  await prisma.building.delete({ where: { id } });

  return createSuccessResponse({ message: "Building deleted successfully" });
}

export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
