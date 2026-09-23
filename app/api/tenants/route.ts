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
  // paymentStatus is derived from the RentPeriod ledger (lib/services/allocation/service.ts), so a
  // new tenant takes the column default. Accepting it here let a tenant be created "paid" with no
  // money behind it; the update route in ./[id] has always refused it for the same reason.
  notes: z.string().max(1000).optional(),
});

// GET /api/tenants - Get all tenants for the authenticated user (with pagination)
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

      const [tenants, total] = await Promise.all([
        prisma.tenant.findMany({
          where: { userId: scopeUserId },
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.tenant.count({
          where: { userId: scopeUserId },
        }),
      ]);

      return createSuccessResponse(createPaginatedResponse(tenants, total, pagination));
    } else {
      // Legacy: Return all tenants (backward compatible)
      const tenants = await tenantService.getAll(scopeUserId);
      return createSuccessResponse(tenants);
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
