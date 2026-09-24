import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { propertyService } from "@/lib/services/database/property";
import { sanitizeForDatabase, sanitizeNumber } from "@/lib/utils/sanitize";
import { z } from "zod";

// Validation schema for updates
const updatePropertySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().min(1).max(500).optional(),
  type: z.enum(["apartment", "house", "condo", "townhouse", "other"]).optional(),
  bedrooms: z.number().min(0).max(100).optional(),
  bathrooms: z.number().min(0).max(100).optional(),
  rent: z.number().min(0).optional(),
  status: z.enum(["occupied", "vacant", "maintenance"]).optional(),
  description: z.string().max(1000).optional(),
  image: z.string().url().optional(),
});

// GET /api/properties/[id] - Get a specific property
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    const property = await propertyService.getById(userId, id);

    if (!property) {
      return createErrorResponse(new Error("Property not found"), 404, request);
    }

    return createSuccessResponse(property);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/properties/[id] - Update a specific property
async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    // First check if property exists and user owns it
    const existingProperty = await propertyService.getById(userId, id);
    if (!existingProperty) {
      return createErrorResponse(new Error("Property not found"), 404, request);
    }

    const body = await request.json();

    // Sanitize input
    const sanitizedBody = {
      ...body,
      name: body.name ? sanitizeForDatabase(body.name) : undefined,
      address: body.address ? sanitizeForDatabase(body.address) : undefined,
      description: body.description ? sanitizeForDatabase(body.description) : undefined,
      image: body.image ? sanitizeForDatabase(body.image) : undefined,
      bedrooms: body.bedrooms !== undefined ? sanitizeNumber(body.bedrooms, 0, 0, 100) : undefined,
      bathrooms:
        body.bathrooms !== undefined ? sanitizeNumber(body.bathrooms, 0, 0, 100) : undefined,
      rent: body.rent !== undefined ? sanitizeNumber(body.rent, 0, 0) : undefined,
    };

    // Validate input
    const validatedData = updatePropertySchema.parse(sanitizedBody);

    const property = await propertyService.update(userId, id, validatedData);
    return createSuccessResponse(property);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        new Error(`Validation error: ${error.issues.map((e) => e.message).join(", ")}`),
        400,
        request,
      );
    }
    return createErrorResponse(error as Error, 500, request);
  }
}

// DELETE /api/properties/[id] - Delete a specific property
async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;
  let id: string | undefined;
  if (context?.params) {
    const maybe = context.params as Record<string, string> | Promise<Record<string, string>>;
    const resolved = maybe instanceof Promise ? await maybe : maybe;
    id = resolved?.id;
  }
  if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

  try {
    // First check if property exists and user owns it
    const existingProperty = await propertyService.getById(userId, id);
    if (!existingProperty) {
      return createErrorResponse(new Error("Property not found"), 404, request);
    }

    await propertyService.delete(userId, id);
    return createSuccessResponse({ message: "Property deleted successfully" });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// Main handler
export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
