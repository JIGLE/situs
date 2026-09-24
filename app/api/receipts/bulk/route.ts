import { NextRequest } from "next/server";
import { handleOptions, requireOwnerAccess } from "@/lib/services/auth/auth-middleware";
import { createSuccessResponse, parseBody, withErrorHandler } from "@/lib/utils/error-handling";
import { withRateLimit } from "@/lib/utils/rate-limit";
import { getPrismaClient } from "@/lib/services/database/database";
import { sanitizeForDatabase } from "@/lib/utils/sanitize";
import { logger } from "@/lib/utils/logger";
import { z } from "zod";
import { Receipt } from "@/lib/types";

const bulkGenerateSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format"),
  leaseIds: z.array(z.string().min(1)).optional(),
});

// POST /api/receipts/bulk — Generate rent receipts for all active leases in a month
async function handlePost(request: NextRequest): Promise<Response> {
  const authResult = await requireOwnerAccess(request);
  if (authResult instanceof Response) return authResult;

  const { scopeUserId } = authResult;

  const raw = await request.json();
  const sanitized = {
    month: raw.month ? sanitizeForDatabase(raw.month) : raw.month,
    leaseIds: Array.isArray(raw.leaseIds)
      ? raw.leaseIds.map((id: unknown) => (typeof id === "string" ? sanitizeForDatabase(id) : id))
      : raw.leaseIds,
  };

  const { month, leaseIds } = parseBody(sanitized, bulkGenerateSchema);

  // Parse month boundaries
  const [year, mon] = month.split("-").map(Number);
  const monthStart = new Date(year, mon - 1, 1);
  const monthEnd = new Date(year, mon, 1); // exclusive upper bound

  const prisma = getPrismaClient();

  // Find active leases belonging to this user, optionally filtered by leaseIds
  const leases = await prisma.lease.findMany({
    where: {
      userId: scopeUserId,
      status: "active",
      ...(leaseIds && leaseIds.length > 0 ? { id: { in: leaseIds } } : {}),
    },
    include: { tenant: true, property: true },
  });

  const generated: Receipt[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const lease of leases) {
    try {
      // Check if a rent receipt already exists for this tenant+property in this month
      const existing = await prisma.receipt.findFirst({
        where: {
          userId: scopeUserId,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          type: "rent",
          date: {
            gte: monthStart,
            lt: monthEnd,
          },
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Create receipt for the first day of the month
      const receipt = await prisma.receipt.create({
        data: {
          userId: scopeUserId,
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          // Linked, so allocation below settles this lease rather than guessing among a tenant's.
          leaseId: lease.id,
          amount: lease.monthlyRent,
          date: monthStart,
          type: "rent",
          status: "paid",
          description: `Monthly rent — ${month}`,
        },
        include: { tenant: true, property: true },
      });

      // Through the reference-month waterfall, as `POST /api/receipts` does for a single receipt.
      // This route never did, and the Finance screen made up for it by POSTing every generated
      // receipt back to that endpoint — which wrote each one a second time. Best-effort for the
      // same reason as there: the receipt is written, and `scripts/backfill-rent-periods.ts`
      // allocates any rent receipt that was missed.
      try {
        const { allocateReceipt } = await import("@/lib/services/allocation/service");
        await allocateReceipt(receipt.id);
      } catch (allocErr) {
        logger.error("Receipt allocation failed", allocErr, { receiptId: receipt.id });
      }

      generated.push({
        id: receipt.id,
        userId: receipt.userId,
        tenantId: receipt.tenantId,
        tenantName: receipt.tenant.name,
        propertyId: receipt.propertyId,
        propertyName: receipt.property.name,
        leaseId: lease.id,
        amount: receipt.amount,
        date: receipt.date.toISOString().split("T")[0],
        type: receipt.type as Receipt["type"],
        status: receipt.status as Receipt["status"],
        description: receipt.description ?? undefined,
        createdAt: receipt.createdAt.toISOString(),
        updatedAt: receipt.updatedAt.toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(
        `Lease ${lease.id} (${(lease.tenant as { name?: string })?.name ?? lease.tenantId}): ${message}`,
      );
    }
  }

  return createSuccessResponse({ generated, skipped, errors }, 200);
}

export const POST = withErrorHandler(withRateLimit(handlePost));
export const OPTIONS = handleOptions;
