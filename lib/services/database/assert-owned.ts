import { getPrismaClient } from "./database";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";

/**
 * Verify that foreign keys supplied by a client belong to the calling user.
 *
 * WHY THIS EXISTS: several `create` paths took `propertyId` / `tenantId` / `ownerId` straight
 * from the request body and wrote them without checking. A session proves someone is logged
 * in; it never proves the ids they sent are theirs. Ids are cuids, but that is obscurity, not
 * authorization — and ids leak through URLs, exports, screenshots and shared links.
 *
 * The consequences were not limited to the write. `invoiceService.getAll` scopes by
 * `OR: [{ property: { userId } }, { tenant: { userId } }, { owner: { userId } }]` rather than
 * by the invoice's own `userId`, so an invoice created with a victim's `tenantId` appeared in
 * the VICTIM's invoice list — and the tenant portal scopes by `tenantId` alone, so it showed
 * up there too. `receiptService.create` returns `include: { tenant: true, property: true }`,
 * the full records, so posting a receipt against an arbitrary tenant echoed back that tenant's
 * email, phone, rent and lease dates.
 *
 * `app/api/property-owners/route.ts` already did this correctly and is the pattern this
 * generalises.
 *
 * Only keys that are present and non-null are checked, so it is safe to pass an object with
 * optional fields straight through.
 *
 * Throws ResourceNotFoundError — 404 rather than 403, matching the convention elsewhere in
 * this codebase: a 403 would confirm that a record exists to someone who does not own it.
 */
export async function assertOwnsRelations(
  userId: string,
  refs: {
    propertyId?: string | null;
    tenantId?: string | null;
    ownerId?: string | null;
    /** A unit has no `userId` of its own; it belongs to whoever owns its property. */
    unitId?: string | null;
  },
): Promise<void> {
  const prisma = getPrismaClient();

  const checks: Promise<void>[] = [];

  if (refs.propertyId) {
    const id = refs.propertyId;
    checks.push(
      prisma.property.findFirst({ where: { id, userId }, select: { id: true } }).then((row) => {
        if (!row) throw new ResourceNotFoundError("Property not found");
      }),
    );
  }

  if (refs.tenantId) {
    const id = refs.tenantId;
    checks.push(
      prisma.tenant.findFirst({ where: { id, userId }, select: { id: true } }).then((row) => {
        if (!row) throw new ResourceNotFoundError("Tenant not found");
      }),
    );
  }

  if (refs.ownerId) {
    const id = refs.ownerId;
    checks.push(
      prisma.owner.findFirst({ where: { id, userId }, select: { id: true } }).then((row) => {
        if (!row) throw new ResourceNotFoundError("Owner not found");
      }),
    );
  }

  if (refs.unitId) {
    const id = refs.unitId;
    checks.push(
      prisma.unit
        .findFirst({ where: { id, property: { userId } }, select: { id: true } })
        .then((row) => {
          if (!row) throw new ResourceNotFoundError("Unit not found");
        }),
    );
  }

  // Promise.all rejects on the first failure, which is the behaviour we want — the caller gets
  // one 404 and no indication of how many of the other ids happened to be valid.
  await Promise.all(checks);
}
