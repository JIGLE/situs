import { getPrismaClient } from "../database";
import { Tenant } from "@/lib/types";
import { assertOwnsRelations } from "../assert-owned";

export const tenantService = {
  async getAll(userId: string): Promise<Tenant[]> {
    const tenants = await getPrismaClient().tenant.findMany({
      where: { userId },
      include: { property: true, receipts: true },
    });
    return tenants.map((t) => ({
      ...t,
      leaseStart: t.leaseStart.toISOString().split("T")[0],
      leaseEnd: t.leaseEnd.toISOString().split("T")[0],
      propertyId: t.propertyId || undefined,
      lastPayment: t.lastPayment?.toISOString(),
      notes: t.notes || undefined,
      propertyName: t.property?.name,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  },

  async getById(userId: string, id: string): Promise<Tenant | null> {
    const tenant = await getPrismaClient().tenant.findFirst({
      where: { id, userId },
      include: { property: true, receipts: true },
    });
    if (!tenant) return null;
    return {
      ...tenant,
      propertyId: tenant.propertyId || undefined,
      leaseStart: tenant.leaseStart.toISOString().split("T")[0],
      leaseEnd: tenant.leaseEnd.toISOString().split("T")[0],
      lastPayment: tenant.lastPayment?.toISOString(),
      notes: tenant.notes || undefined,
      propertyName: tenant.property?.name,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  },

  async create(
    userId: string,
    data: Omit<
      Tenant,
      "id" | "userId" | "createdAt" | "updatedAt" | "propertyName" | "paymentStatus"
    >,
  ): Promise<Tenant> {
    // `propertyId` arrives from the request body, and this create returns
    // `include: { property: true }` — the full property record, address and coordinates
    // included — so an unchecked id both mis-filed the tenant and echoed back a property the
    // caller has no claim to.
    await assertOwnsRelations(userId, { propertyId: data.propertyId });

    // `leaseStart`/`leaseEnd` are legacy required (non-null) columns on Tenant, but the
    // create dialog treats lease details as optional ("Add lease & contact details"),
    // and the real lease record is created separately via the Leases workflow. Default
    // to a one-year term from today rather than `new Date("")` (Invalid Date), which
    // Prisma rejects and previously 500'd on the minimal name+email path.
    const leaseStart = data.leaseStart ? new Date(data.leaseStart) : new Date();
    const leaseEnd = data.leaseEnd
      ? new Date(data.leaseEnd)
      : new Date(leaseStart.getFullYear() + 1, leaseStart.getMonth(), leaseStart.getDate());
    const tenant = await getPrismaClient().tenant.create({
      data: {
        userId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        propertyId: data.propertyId,
        rent: data.rent,
        leaseStart,
        leaseEnd,
        // paymentStatus is left to the column default: the RentPeriod ledger derives it
        // (lib/services/allocation/service.ts), never the caller.
        lastPayment: data.lastPayment ? new Date(data.lastPayment) : null,
        notes: data.notes,
      },
      include: { property: true },
    });
    return {
      ...tenant,
      propertyId: tenant.propertyId || undefined,
      leaseStart: tenant.leaseStart.toISOString().split("T")[0],
      leaseEnd: tenant.leaseEnd.toISOString().split("T")[0],
      lastPayment: tenant.lastPayment?.toISOString(),
      notes: tenant.notes || undefined,
      propertyName: tenant.property?.name,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  },

  async update(
    userId: string,
    id: string,
    data: Partial<Omit<Tenant, "id" | "userId" | "createdAt" | "updatedAt" | "propertyName">>,
  ): Promise<Tenant> {
    // As in `create`: the update `include`s the property, so an unchecked id would echo back a
    // property the caller has no claim to.
    await assertOwnsRelations(userId, { propertyId: data.propertyId });

    const tenant = await getPrismaClient().tenant.update({
      where: { id, userId },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        propertyId: data.propertyId,
        rent: data.rent,
        leaseStart: data.leaseStart ? new Date(data.leaseStart) : undefined,
        leaseEnd: data.leaseEnd ? new Date(data.leaseEnd) : undefined,
        // paymentStatus is derived from the RentPeriod ledger (Situs Migration A —
        // lib/services/allocation/service.ts), never accepted here.
        lastPayment: data.lastPayment ? new Date(data.lastPayment) : undefined,
        notes: data.notes,
      },
      include: { property: true },
    });
    return {
      ...tenant,
      propertyId: tenant.propertyId || undefined,
      leaseStart: tenant.leaseStart.toISOString().split("T")[0],
      leaseEnd: tenant.leaseEnd.toISOString().split("T")[0],
      lastPayment: tenant.lastPayment?.toISOString(),
      notes: tenant.notes || undefined,
      propertyName: tenant.property?.name,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  },

  async delete(userId: string, id: string): Promise<void> {
    await getPrismaClient().tenant.delete({ where: { id, userId } });
  },
};
