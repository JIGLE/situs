import { getPrismaClient } from "../database";
import { assertOwnsRelations } from "../assert-owned";
import { Receipt } from "@/lib/types";
import { reverseAllocationsForReceipt } from "@/lib/services/allocation/service";
import { isFiled } from "@/lib/services/receipts/lifecycle";

/** A receipt that went to Finanças stays: deleting it here would not void it at AT. */
export class ReceiptFiledError extends Error {
  constructor() {
    super("A receipt submitted to Finanças cannot be deleted");
    this.name = "ReceiptFiledError";
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

    const receipt = await getPrismaClient().receipt.create({
      data: {
        userId,
        tenantId: data.tenantId,
        propertyId: data.propertyId,
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
