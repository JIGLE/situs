import { getPrismaClient } from "../database";
import { assertOwnsRelations } from "../assert-owned";
import { Receipt } from "@/lib/types";

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

  async delete(userId: string, id: string): Promise<void> {
    await getPrismaClient().receipt.delete({ where: { id, userId } });
  },
};
