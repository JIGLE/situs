import { NextRequest } from "next/server";
import { requireAuth, handleOptions } from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { tenantService } from "@/lib/services/database/tenant";
import { sanitizeForDatabase, sanitizeEmail, sanitizeNumber } from "@/lib/utils/sanitize";
import { z } from "zod";

// Validation schema for updates
const updateTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(20).optional(),
  propertyId: z.string().optional(),
  rent: z.number().min(0).optional(),
  leaseStart: z.string().datetime().optional(),
  leaseEnd: z.string().datetime().optional(),
  // paymentStatus is derived from the RentPeriod ledger (Situs Migration A —
  // lib/services/allocation/service.ts) and is never accepted from a manual
  // edit; a value here would silently drift the next time an allocation runs.
  notes: z.string().max(1000).optional(),
  // Empty string clears it back to "derive from the property's country" — the modal sends "" for
  // its Auto option, and a nullable column is what that means.
  locale: z.enum(["pt", "es", "en", "it"]).or(z.literal("")).optional(),
});

// GET /api/tenants/[id] - Get a specific tenant
async function handleGet(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAuth(request);
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
    const tenant = await tenantService.getById(userId, id);

    if (!tenant) {
      return createErrorResponse(new Error("Tenant not found"), 404, request);
    }

    return createSuccessResponse(tenant);
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// PUT /api/tenants/[id] - Update a specific tenant
async function handlePut(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const { userId } = authResult;

  try {
    // Resolve id from context params
    const maybeParams = context?.params as
      Record<string, string> | Promise<Record<string, string>> | undefined;
    const resolvedParams = maybeParams instanceof Promise ? await maybeParams : maybeParams;
    const id = resolvedParams?.id;
    if (!id) return createErrorResponse(new Error("Invalid request: missing id"), 400, request);

    // First check if tenant exists and user owns it
    const existingTenant = await tenantService.getById(userId, id);
    if (!existingTenant) {
      return createErrorResponse(new Error("Tenant not found"), 404, request);
    }

    const body = await request.json();

    // Sanitize input
    const sanitizedBody = {
      ...body,
      name: body.name ? sanitizeForDatabase(body.name) : undefined,
      email: body.email ? sanitizeEmail(body.email) : undefined,
      phone: body.phone ? sanitizeForDatabase(body.phone) : undefined,
      propertyId: body.propertyId ? sanitizeForDatabase(body.propertyId) : undefined,
      rent: body.rent !== undefined ? sanitizeNumber(body.rent, 0, 0) : undefined,
      notes: body.notes ? sanitizeForDatabase(body.notes) : undefined,
      locale: body.locale === "" ? null : body.locale,
    };

    // Validate input
    const validatedData = updateTenantSchema.parse(sanitizedBody);

    const tenant = await tenantService.update(userId, id, validatedData);
    return createSuccessResponse(tenant);
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

// DELETE /api/tenants/[id] - Delete a specific tenant
async function handleDelete(
  request: NextRequest,
  context?: { params?: Record<string, string> | Promise<Record<string, string>> },
): Promise<Response> {
  const authResult = await requireAuth(request);
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
    // First check if tenant exists and user owns it
    const existingTenant = await tenantService.getById(userId, id);
    if (!existingTenant) {
      return createErrorResponse(new Error("Tenant not found"), 404, request);
    }

    await tenantService.delete(userId, id);
    return createSuccessResponse({ message: "Tenant deleted successfully" });
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// Main handler
export const GET = withErrorHandler(handleGet);
export const PUT = withErrorHandler(handlePut);
export const DELETE = withErrorHandler(handleDelete);
export const OPTIONS = handleOptions;
