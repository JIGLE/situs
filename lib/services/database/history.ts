import { getPrismaClient } from "./database";
import { ConflictError } from "@/lib/utils/error-handling";

/**
 * A tenant, a property or a lease with money history is kept, and so is an owner who is still
 * a landlord.
 *
 * In `prisma/schema.prisma`, Lease, Receipt, RentPeriod and RentReceipt are all
 * `onDelete: Cascade` from Tenant and from Property. RentPeriod, and with it every
 * PaymentAllocation, cascades from Lease. So one delete took the receipts, the rent ledger and
 * the AT filing records with it, and a property took its expenses too. A tenancy stops by ending
 * its lease, and the record stays for the owner's accounts and tax history.
 *
 * A record with nothing recorded against it can still go: a lease entered by mistake has rent
 * months but no payments, and deleting it takes only those months.
 */

export type HistoryEntity = "tenant" | "property" | "lease" | "owner";

export class HasHistoryError extends ConflictError {
  constructor(entity: HistoryEntity) {
    super(
      entity === "owner"
        ? "This owner is a landlord of a property or has income shares, so it is kept"
        : `This ${entity} has lease or payment history, so it is kept`,
      `${entity}_has_history`,
    );
    this.name = "HasHistoryError";
  }
}

async function anyOf(counts: Promise<number>[]): Promise<boolean> {
  return (await Promise.all(counts)).some((count) => count > 0);
}

/** Its leases, receipts, rent months and AT filings. */
export async function assertTenantHasNoHistory(userId: string, tenantId: string): Promise<void> {
  const prisma = getPrismaClient();
  const where = { userId, tenantId };
  const kept = await anyOf([
    prisma.lease.count({ where }),
    prisma.receipt.count({ where }),
    prisma.rentPeriod.count({ where }),
    prisma.rentReceipt.count({ where }),
  ]);
  if (kept) throw new HasHistoryError("tenant");
}

/** Its leases, receipts, rent months, AT filings and expenses. */
export async function assertPropertyHasNoHistory(
  userId: string,
  propertyId: string,
): Promise<void> {
  const prisma = getPrismaClient();
  const where = { userId, propertyId };
  const kept = await anyOf([
    prisma.lease.count({ where }),
    prisma.receipt.count({ where }),
    prisma.rentPeriod.count({ where }),
    prisma.rentReceipt.count({ where }),
    prisma.expense.count({ where }),
  ]);
  if (kept) throw new HasHistoryError("property");
}

/**
 * Money recorded against it: a receipt linked to it, a live allocation on one of its months, or
 * an AT filing. Its rent months alone are not history; they are generated from the lease.
 */
export async function assertLeaseHasNoHistory(userId: string, leaseId: string): Promise<void> {
  const prisma = getPrismaClient();
  const kept = await anyOf([
    prisma.receipt.count({ where: { userId, leaseId } }),
    prisma.paymentAllocation.count({
      where: { userId, reversedAt: null, rentPeriod: { leaseId } },
    }),
    prisma.rentReceipt.count({
      where: { userId, OR: [{ leaseId }, { rentPeriod: { leaseId } }] },
    }),
  ]);
  if (kept) throw new HasHistoryError("lease");
}

/**
 * The properties it is a landlord of, and the income distributions it has a share in. Both are
 * `onDelete: Cascade` from Owner, so deleting it would take the landlord off every receipt for
 * those properties and its share out of every distribution already made. Detaching it from its
 * properties first is the way to remove one.
 */
export async function assertOwnerHasNoHistory(userId: string, ownerId: string): Promise<void> {
  const prisma = getPrismaClient();
  const where = { ownerId, owner: { userId } };
  const kept = await anyOf([
    prisma.propertyOwner.count({ where }),
    prisma.incomeDistributionShare.count({ where }),
  ]);
  if (kept) throw new HasHistoryError("owner");
}
