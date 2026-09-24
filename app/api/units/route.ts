import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import { getPrismaClient } from "@/lib/services/database/database";
import { isMockMode } from "@/lib/config/data-mode";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { createUnitSchema } from "@/lib/schemas/unit.schema";

async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;

  if (isMockMode) {
    return createSuccessResponse([]);
  }

  const prisma = getPrismaClient();
  const units = await prisma.unit.findMany({
    where: {
      property: {
        userId,
      },
    },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      leases: {
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return createSuccessResponse(units);
}

async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  // Invalid input answers 400 (ValidationError) before anything is read or written.
  const { propertyId, ...fields } = parseBody(await request.json(), createUnitSchema);

  const prisma = getPrismaClient();

  // Verify property ownership
  const property = await prisma.property.findFirst({
    where: {
      id: propertyId,
      userId,
    },
  });

  if (!property) {
    return createErrorResponse(new Error("Property not found or access denied"), 404, request);
  }

  try {
    const unit = await prisma.unit.create({
      // Taken as validated: `floor ? parseInt(floor) : null` stored a ground floor (0) and a
      // T0's zero bedrooms as empty. A unit sent without a status takes the column default.
      data: { propertyId, ...fields },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
      },
    });

    return createSuccessResponse(unit, 201);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return createErrorResponse(
        new Error("A unit with this number already exists for this property"),
        409,
        request,
      );
    }
    throw error;
  }
}

export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
