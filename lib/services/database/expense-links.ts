import { getPrismaClient } from "./database";
import { assertOwnsRelations } from "./assert-owned";
import { ResourceNotFoundError, ValidationError } from "@/lib/utils/error-handling";

/**
 * Check every record an expense points at: the property, the optional lease and the optional
 * evidence document.
 *
 * Only the property used to be checked. `leaseId` and `documentId` came from the body and were
 * written as sent, so an expense could name another account's lease or document, or a lease on a
 * different property than the one it is booked against, which then disagree about where the cost
 * belongs. Pass the values the expense will hold after the write: on an update, the stored ones
 * for any field the request leaves out.
 */
export async function assertExpenseLinks(
  userId: string,
  links: { propertyId: string; leaseId?: string | null; documentId?: string | null },
): Promise<void> {
  await assertOwnsRelations(userId, { propertyId: links.propertyId });
  const prisma = getPrismaClient();

  if (links.leaseId) {
    const lease = await prisma.lease.findFirst({
      where: { id: links.leaseId, userId },
      select: { propertyId: true },
    });
    if (!lease) throw new ResourceNotFoundError("Lease not found");
    if (lease.propertyId !== links.propertyId) {
      throw new ValidationError("The lease is not on this expense's property", "leaseId");
    }
  }

  if (links.documentId) {
    const document = await prisma.document.findFirst({
      where: { id: links.documentId, userId },
      select: { id: true },
    });
    if (!document) throw new ResourceNotFoundError("Document not found");
  }
}
