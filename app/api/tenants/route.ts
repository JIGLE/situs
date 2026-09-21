import { NextRequest } from "next/server";
import {
  getAccessContext,
  handleOptions,
  requireOwnerAccess,
} from "@/lib/services/auth/auth-middleware";
import {
  createErrorResponse,
  createSuccessResponse,
  parseBody,
  withErrorHandler,
} from "@/lib/utils/error-handling";
import { tenantService } from "@/lib/services/database/tenant";
import { sanitizeForDatabase, sanitizeEmail, sanitizeNumber } from "@/lib/utils/sanitize";
import { getPaginationFromRequest, createPaginatedResponse } from "@/lib/utils/pagination";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { z } from "zod";

// Validation schemas
const createTenantSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(20).optional().default(""),
  propertyId: z.string().optional(),
  rent: z.number().min(0).optional().default(0),
  leaseStart: z.string().optional().default(""),
  leaseEnd: z.string().optional().default(""),
  paymentStatus: z.enum(["paid", "overdue", "pending"]).default("pending"),
  notes: z.string().max(1000).optional(),
});

const _updateTenantSchema = createTenantSchema.partial();

// GET /api/tenants - Get all tenants for the authenticated user (with pagination)
async function handleGet(request: NextRequest): Promise<Response> {
  const authResult = await getAccessContext(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId, portalRole, tenantId } = authResult;

  try {
    // Check if pagination is requested
    const url = new URL(request.url);
    const usePagination = url.searchParams.has("page") || url.searchParams.has("limit");

    if (usePagination) {
      // Paginated response
      const pagination = getPaginationFromRequest(request, 50, 100);
      const prisma = getPrismaClient();

      const [tenants, total] = await Promise.all([
        prisma.tenant.findMany({
          where:
            portalRole === "tenant" && tenantId
              ? { userId: scopeUserId, id: tenantId }
              : { userId: scopeUserId },
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.tenant.count({
          where:
            portalRole === "tenant" && tenantId
              ? { userId: scopeUserId, id: tenantId }
              : { userId: scopeUserId },
        }),
      ]);

      return createSuccessResponse(createPaginatedResponse(tenants, total, pagination));
    } else {
      // Legacy: Return all tenants (backward compatible)
      const tenants = await tenantService.getAll(scopeUserId);
      return createSuccessResponse(
        portalRole === "tenant" && tenantId
          ? tenants.filter((tenant) => tenant.id === tenantId)
          : tenants,
      );
    }
  } catch (error) {
    return createErrorResponse(error as Error, 500, request);
  }
}

// POST /api/tenants - Create a new tenant
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;

  const raw = await request.json();
  const sanitizedBody = {
    ...raw,
    name: sanitizeForDatabase(raw.name),
    email: sanitizeEmail(raw.email),
    phone: sanitizeForDatabase(raw.phone),
    propertyId: raw.propertyId ? sanitizeForDatabase(raw.propertyId) : undefined,
    rent: sanitizeNumber(raw.rent, 0, 0),
    notes: raw.notes ? sanitizeForDatabase(raw.notes) : undefined,
  };

  const validatedData = parseBody(sanitizedBody, createTenantSchema);
  const tenant = await tenantService.create(scopeUserId, validatedData);
  return createSuccessResponse(tenant, 201);
}

// Main handler
export const GET = withErrorHandler(withRateLimit(handleGet));
export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
