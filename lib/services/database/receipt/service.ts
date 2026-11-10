import { getPrismaClient } from "../database";
import { assertOwnsRelations } from "../assert-owned";
import { Receipt } from "@/lib/types";
import { reverseAllocationsForReceipt } from "@/lib/services/allocation/service";
import { isFiled } from "@/lib/services/receipts/lifecycle";
import { ConflictError, ResourceNotFoundError, ValidationError } from "@/lib/utils/error-handling";
import { MONEY_EPSILON } from "@/lib/utils/money";

/** A receipt that went to Finanças stays: deleting it here would not void it at AT. */
export class ReceiptFiledError extends Error {
  constructor() {
    super("A receipt submitted to Finanças cannot be deleted");
    this.name = "ReceiptFiledError";
  }
}

/** The fields that say what money arrived, from whom, for what: the ledger was written from them. */
type MoneyFields = Partial<
  Pick<Receipt, "tenantId" | "propertyId" | "amount" | "date" | "type" | "status">
>;

/** A receipt the tenant holds: it left draft and review. */
const ISSUED_LIFECYCLES = new Set(["emitted", "submitted", "accepted"]);

/**
 * Refuse a change to what a receipt says about money once that money is on the ledger.
 *
 * The rent months a receipt paid were written from its amount, date, tenant and property. Editing
 * any of them afterwards changed the receipt and left its allocations as they were: the ledger then
 * said one amount was paid and the receipt another, or a month named one tenant and the receipt
 * paying it another. A correction is a void (which reverses the allocations) and a new receipt. A
 * receipt already issued is the document the tenant holds, so it keeps its figures too. A
 * description is not money and can always change. A field sent with its current value passes,
 * since the edit form sends every field.
 */
async function assertMoneyUnchangedOnceAllocated(
  userId: string,
  id: string,
  data: MoneyFields,
): Promise<void> {
  const prisma = getPrismaClient();
  const current = await prisma.receipt.findFirst({
    where: { id, userId },
    select: {
      tenantId: true,
      propertyId: true,
      amount: true,
      date: true,
      type: true,
      status: true,
      lifecycle: true,
    },
  });
  if (!current) throw new ResourceNotFoundError("Receipt");

  const changes =
    (data.tenantId !== undefined && data.tenantId !== current.tenantId) ||
    (data.propertyId !== undefined && data.propertyId !== current.propertyId) ||
    (data.amount !== undefined && Math.abs(data.amount - current.amount) > MONEY_EPSILON) ||
    (data.date !== undefined &&
      new Date(data.date).toISOString().slice(0, 10) !== current.date.toISOString().slice(0, 10)) ||
    (data.type !== undefined && data.type !== current.type) ||
    (data.status !== undefined && data.status !== current.status);
  if (!changes) return;

  const allocated = await prisma.paymentAllocation.count({
    where: { receiptId: id, reversedAt: null },
  });
  if (allocated > 0 || ISSUED_LIFECYCLES.has(current.lifecycle)) {
    throw new ConflictError(
      "This receipt's payment is recorded; void it and record a new one instead",
      "receipt_allocated",
    );
  }
}

export const receiptService = {
  async getAll(userId: string): Promise<Receipt[]> {
    const receipts = await getPrismaClient().receipt.findMany({
      where: { userId },
      include: { tenant: true, property: true },
    });
    return receipts.map((r) => ({
      ...r,
      description: r.description || undefined,
      leaseId: (r as unknown as { leaseId: string | null }).leaseId ?? undefined,
      date: r.date.toISOString().split("T")[0],
      tenantName: r.tenant.name,
      propertyName: r.property.name,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  },

  async getById(userId: string, id: string): Promise<Receipt | null> {
    const receipt = await getPrismaClient().receipt.findUnique({
      where: { id, userId },
      include: { tenant: true, property: true },
    });
    if (!receipt) return null;
    const receiptData = receipt;
    return {
      ...receiptData,
      description: receiptData.description ?? undefined,
      leaseId: (receiptData as unknown as { leaseId: string | null }).leaseId ?? undefined,
      date: receipt.date.toISOString().split("T")[0],
      tenantName: receipt.tenant.name,
      propertyName: receipt.property.name,
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString(),
    };
  },

  async create(
    userId: string,
    data: Omit<
      Receipt,
      "id" | "userId" | "createdAt" | "updatedAt" | "tenantName" | "propertyName"
    >,
  ): Promise<Receipt> {
    // tenantId and propertyId arrive from the request body. This create `include`s the FULL
    // tenant and property records in its response — email, phone, rent, lease dates, address,
    // coordinates — so without this check, posting a receipt against an arbitrary tenant id
    // echoed that tenant's personal data straight back to the caller.
    await assertOwnsRelations(userId, {
      tenantId: data.tenantId,
      propertyId: data.propertyId,
    });
    // The lease decides which contract's months the payment settles, so it must be the caller's,
    // and the tenant's lease on that property. Without one, allocation gives up on a tenant with
    // two active leases, and the payment reaches no month at all.
    if (data.leaseId) {
      const lease = await getPrismaClient().lease.findFirst({
        where: { id: data.leaseId, userId },
        select: { tenantId: true, propertyId: true },
      });
      if (!lease) throw new ResourceNotFoundError("Lease");
      if (lease.tenantId !== data.tenantId || lease.propertyId !== data.propertyId) {
        throw new ValidationError("The lease is not this tenant's on this property", "leaseId");
      }
    }

    const receipt = await getPrismaClient().receipt.create({
      data: {
        userId,
        tenantId: data.tenantId,
        propertyId: data.propertyId,
        leaseId: data.leaseId,
        amount: data.amount,
        date: new Date(data.date),
        type: data.type,
        status: data.status,
        description: data.description,
      },
      include: { tenant: true, property: true },
    });
    const receiptData = receipt;
    return {
      ...receiptData,
      description: receiptData.description ?? undefined,
      leaseId: (receiptData as unknown as { leaseId: string | null }).leaseId ?? undefined,
      date: receipt.date.toISOString().split("T")[0],
      tenantName: receipt.tenant.name,
      propertyName: receipt.property.name,
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString(),
    };
  },

  async update(
    userId: string,
    id: string,
    data: Partial<
      Omit<Receipt, "id" | "userId" | "createdAt" | "updatedAt" | "tenantName" | "propertyName">
    >,
  ): Promise<Receipt> {
    // The same check `create` makes, for the same reason: this update `include`s the full tenant
    // and property, so an unchecked id re-pointed the receipt AND echoed back a stranger's records.
    await assertOwnsRelations(userId, {
      tenantId: data.tenantId,
      propertyId: data.propertyId,
    });

    await assertMoneyUnchangedOnceAllocated(userId, id, data);
    const receipt = await getPrismaClient().receipt.update({
      where: { id, userId },
      data: {
        tenantId: data.tenantId,
        propertyId: data.propertyId,
        amount: data.amount,
        date: data.date ? new Date(data.date) : undefined,
        type: data.type,
        status: data.status,
        description: data.description,
      },
      include: { tenant: true, property: true },
    });
    const receiptData = receipt;
    return {
      ...receiptData,
      description: receiptData.description ?? undefined,
      leaseId: (receiptData as unknown as { leaseId: string | null }).leaseId ?? undefined,
      date: receipt.date.toISOString().split("T")[0],
      tenantName: receipt.tenant.name,
      propertyName: receipt.property.name,
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString(),
    };
  },

  /**
   * Delete a receipt and take its payment off the rent ledger, in one transaction.
   *
   * `PaymentAllocation.receipt` is `onDelete: SetNull`, so a bare delete left every allocation
   * live: the month the receipt paid still read paid with no receipt behind it, and no alert
   * chased it. The reversal is the one a void runs, so the allocation rows stay as history and
   * the months and the tenant's status are recomputed. It has to come first: once the receipt is
   * gone, its allocations no longer name it.
   *
   * A bank movement the receipt came from goes back to the inbox, since its money is no longer
   * allocated to anything and would otherwise sit matched to nothing, out of sight.
   */
  async delete(userId: string, id: string): Promise<void> {
    const prisma = getPrismaClient();
    const { lifecycle } = await prisma.receipt.findUniqueOrThrow({
      where: { id, userId },
      select: { lifecycle: true },
    });
    if (isFiled(lifecycle)) throw new ReceiptFiledError();

    await prisma.$transaction(async (tx) => {
      await reverseAllocationsForReceipt(id, "Receipt deleted", tx);
      await tx.bankTransaction.updateMany({
        where: { receiptId: id, userId },
        data: { status: "needs_review" },
      });
      await tx.receipt.delete({ where: { id, userId } });
    });
  },
};
