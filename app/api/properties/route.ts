import { NextRequest } from "next/server";
import {
  getAccessContext,
  handleOptions,
  requireOwnerAccess,
} from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { propertyService } from "@/lib/services/database/property";
import { sanitizeForDatabase, sanitizeNumber } from "@/lib/utils/sanitize";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { propertySchema } from "@/lib/schemas/property.schema";
import { getPaginationFromRequest, createPaginatedResponse } from "@/lib/utils/pagination";
import { getPrismaClient } from "@/lib/services/database/database";
import { ZodError } from "zod";

// GET /api/properties - Get all properties for the authenticated user (with pagination)
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await getAccessContext(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;

  try {
    // Check if pagination is requested
    const url = new URL(request.url);
    const usePagination = url.searchParams.has("page") || url.searchParams.has("limit");

    if (usePagination) {
      // Paginated response
      const pagination = getPaginationFromRequest(request, 50, 100);
      const prisma = getPrismaClient();

      const [properties, total] = await Promise.all([
        prisma.property.findMany({
          where: { userId: scopeUserId },
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.property.count({
          where: { userId: scopeUserId },
        }),
      ]);

      return createSuccessResponse(createPaginatedResponse(properties, total, pagination));
    } else {
      // Legacy: Return all properties (backward compatible)
      const properties = await propertyService.getAll(scopeUserId);
      return createSuccessResponse(properties);
    }
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// POST /api/properties - Create a new property
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;

  try {
    const body = await request.json();

    // Validate with shared schema
    const validatedData = propertySchema.parse(body);

    // Sanitize input
    const sanitizedData = {
      ...validatedData,
      name: sanitizeForDatabase(validatedData.name),
      address: sanitizeForDatabase(validatedData.address),
      description: validatedData.description
        ? sanitizeForDatabase(validatedData.description)
        : undefined,
      streetAddress: validatedData.streetAddress
        ? sanitizeForDatabase(validatedData.streetAddress)
        : undefined,
      city: validatedData.city ? sanitizeForDatabase(validatedData.city) : undefined,
      zipCode: validatedData.zipCode || undefined,
      cadasterReference: validatedData.cadasterReference
        ? sanitizeForDatabase(validatedData.cadasterReference)
        : undefined,
      fraction: validatedData.fraction ? sanitizeForDatabase(validatedData.fraction) : undefined,
      bedrooms: sanitizeNumber(validatedData.bedrooms, 0, 0, 20),
      bathrooms: sanitizeNumber(validatedData.bathrooms, 0, 0, 20),
      rent: sanitizeNumber(validatedData.rent, 0, 0),
    };

    const property = await propertyService.create(scopeUserId, sanitizedData);
    return createSuccessResponse(property, 201);
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

// Main handler
export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
