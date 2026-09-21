import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { maintenanceSchema } from "@/lib/schemas/maintenance.schema";
import { isMockMode } from "@/lib/config/data-mode";
import { ZodError } from "zod";

const ticketInclude = {
  property: { select: { name: true } },
  tenant: { select: { name: true } },
};

function flattenTicket(
  ticket: Record<string, unknown> & {
    property: { name: string };
    tenant?: { name: string } | null;
  },
) {
  const images = ticket.images;
  return {
    ...ticket,
    propertyName: ticket.property.name,
    tenantName: ticket.tenant?.name,
    images: typeof images === "string" ? (JSON.parse(images) as string[]) : (images ?? []),
  };
}

async function handleGet(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse([]);
  }

  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  const prisma = getPrismaClient();

  const tickets = await prisma.maintenanceTicket.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: ticketInclude,
  });

  return createSuccessResponse(tickets.map(flattenTicket));
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
    const body = maintenanceSchema.parse(json);

    const ticket = await prisma.maintenanceTicket.create({
      data: {
        ...body,
        userId,
        images: "[]",
      },
      include: ticketInclude,
    });

    return createSuccessResponse(flattenTicket(ticket), 201);
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
