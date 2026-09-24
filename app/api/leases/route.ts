import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
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
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { leaseSchema } from "@/lib/schemas/lease.schema";
import { isMockMode } from "@/lib/config/data-mode";
import { ZodError } from "zod";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import { partiesByLease, replaceLeaseParties } from "@/lib/services/database/lease-parties";

const leaseInclude = {
  property: { select: { name: true, address: true } },
  tenant: { select: { name: true, email: true } },
  // What a contract import kept of its clauses. Plain text, not PII, so an include reads it whole.
  clauses: {
    select: { id: true, kind: true, summary: true, quote: true, page: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.LeaseInclude;

async function handleGet(request: NextRequest): Promise<Response> {
  if (isMockMode) {
    return createSuccessResponse([]);
  }

  const authResult = await getAccessContext(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;
  const prisma = getPrismaClient();

  // The contract's bytes are not here: the client omits them from every lease read, and
  // /api/leases/[id]/contract serves them. This list used to carry every lease's whole PDF.
  const leases = await prisma.lease.findMany({
    where: { userId: scopeUserId },
    orderBy: { createdAt: "desc" },
    include: leaseInclude,
  });
  const parties = await partiesByLease(
    scopeUserId,
    leases.map((lease) => lease.id),
  );

  return createSuccessResponse(
    leases.map((lease) => ({ ...lease, parties: parties.get(lease.id) ?? [] })),
  );
}

async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;
  const prisma = getPrismaClient();

  try {
    const json = await request.json();
    const { parties, ...body } = leaseSchema.parse(json);

    // Both ids come from the body. A lease is the record that binds a tenant to a property
    // and drives the rent ledger, so creating one against records the caller does not own
    // would write into another landlord's finances, not just leave a stray row.
    await assertOwnsRelations(scopeUserId, {
      propertyId: body.propertyId,
      tenantId: body.tenantId,
    });

    // The contract PDF is uploaded afterwards, to /api/leases/[id]/contract. It used to arrive
    // here inside the JSON, as an array of numbers.
    const lease = await prisma.$transaction(async (tx) => {
      const created = await tx.lease.create({
        data: {
          ...body,
          userId: scopeUserId,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          atContractNumber: body.atContractNumber || null,
        },
        include: leaseInclude,
      });
      if (parties) await replaceLeaseParties(tx, scopeUserId, created.id, parties);
      return created;
    });

    // Situs: seed the reference-month ledger for the new lease (idempotent,
    // best-effort — the backfill script re-covers any miss).
    try {
      const { generateRentPeriods } = await import("@/lib/services/allocation/service");
      await generateRentPeriods(lease.id);
    } catch {
      // Ledger generation must never block lease creation.
    }

    const saved = await partiesByLease(scopeUserId, [lease.id]);
    return createSuccessResponse({ ...lease, parties: saved.get(lease.id) ?? [] }, 201);
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
