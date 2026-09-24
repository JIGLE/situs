import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { propertyService } from "@/lib/services/database/property";
import { sanitizeForDatabase } from "@/lib/utils/sanitize";
import { updatePropertySchema } from "@/lib/schemas/property.schema";
import { z } from "zod";

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

    // The shared fields, all optional. This route used to parse a list of its own that lacked the
    // address and building fields, which z.object drops, so an edit to them was silently lost;
    // its type list also lacked "commercial", so such a property could not be edited at all.
    const validatedData = updatePropertySchema.parse(await request.json());

    // Sanitized after validation, as POST does. A blank stays "" rather than becoming undefined:
    // on an edit it means "clear this field", and the service reads "" back as absent.
    const clean = (value?: string) => (value ? sanitizeForDatabase(value) : value);
    const property = await propertyService.update(userId, id, {
      ...validatedData,
      name: clean(validatedData.name),
      address: clean(validatedData.address),
      streetAddress: clean(validatedData.streetAddress),
      city: clean(validatedData.city),
      description: clean(validatedData.description),
      image: clean(validatedData.image),
    });
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
