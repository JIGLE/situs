import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../database";
import { Tenant } from "@/lib/types";
import { assertOwnsRelations } from "../assert-owned";
import { assertTenantHasNoHistory } from "../history";
import { refuseDuplicateEmail } from "../unique-email";
import { blankToNull } from "@/lib/schemas/tax-identity";
import { deriveTenants, type DerivedTenant } from "../derived-state";

type TenantRow = Prisma.TenantGetPayload<{ include: { property: true } }>;

const day = (date: Date) => date.toISOString().split("T")[0];

/**
 * A tenant as the app reads it. Its lease fields and payment status come from its leases and the
 * rent ledger (`../derived-state.ts`); the stored copies stand only for a tenant no lease names.
 */
function toTenant(row: TenantRow, derived: DerivedTenant | undefined): Tenant {
  const { property, ...tenant } = row;
  return {
    ...tenant,
    propertyId: (derived ? derived.propertyId : tenant.propertyId) || undefined,
    propertyName: (derived ? derived.propertyName : property?.name) ?? undefined,
    rent: derived?.rent ?? tenant.rent,
    leaseStart: day(derived?.leaseStart ?? tenant.leaseStart),
    leaseEnd: day(derived?.leaseEnd ?? tenant.leaseEnd),
    paymentStatus: derived?.paymentStatus ?? tenant.paymentStatus,
    lastPayment: tenant.lastPayment?.toISOString(),
    notes: tenant.notes || undefined,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

async function withDerived(userId: string, row: TenantRow): Promise<Tenant> {
  const derived = await deriveTenants(userId, [row.id]);
  return toTenant(row, derived.get(row.id));
}

export const tenantService = {
  /** Every tenant, or one page of them, newest first, when `page` is given. */
  async getAll(userId: string, page?: { skip: number; take: number }): Promise<Tenant[]> {
    const tenants = await getPrismaClient().tenant.findMany({
      where: { userId },
      include: { property: true },
      ...(page
        ? { skip: page.skip, take: page.take, orderBy: { createdAt: "desc" as const } }
        : {}),
    });
    const derived = await deriveTenants(
      userId,
      tenants.map((t) => t.id),
    );
    return tenants.map((t) => toTenant(t, derived.get(t.id)));
  },

  async getById(userId: string, id: string): Promise<Tenant | null> {
    const tenant = await getPrismaClient().tenant.findFirst({
      where: { id, userId },
      include: { property: true },
    });
    if (!tenant) return null;
    return withDerived(userId, tenant);
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
    const tenant = await refuseDuplicateEmail("tenant", () =>
      getPrismaClient().tenant.create({
        data: {
          userId,
          name: data.name,
          // An email or a phone the owner does not have is NULL, never "".
          email: blankToNull(data.email) ?? null,
          phone: blankToNull(data.phone) ?? null,
          propertyId: data.propertyId,
          rent: data.rent,
          leaseStart,
          leaseEnd,
          // paymentStatus is left to the column default: the RentPeriod ledger derives it
          // (lib/services/allocation/service.ts), never the caller.
          lastPayment: data.lastPayment ? new Date(data.lastPayment) : null,
          notes: data.notes,
          taxId: data.taxId ?? null,
          taxCountry: data.taxCountry ?? "PT",
          idDocument: data.idDocument ?? null,
        },
        include: { property: true },
      }),
    );
    return withDerived(userId, tenant);
  },

  async update(
    userId: string,
    id: string,
    data: Partial<Omit<Tenant, "id" | "userId" | "createdAt" | "updatedAt" | "propertyName">>,
  ): Promise<Tenant> {
    // As in `create`: the update `include`s the property, so an unchecked id would echo back a
    // property the caller has no claim to.
    await assertOwnsRelations(userId, { propertyId: data.propertyId });

    const tenant = await refuseDuplicateEmail("tenant", () =>
      getPrismaClient().tenant.update({
        where: { id, userId },
        data: {
          name: data.name,
          // Undefined leaves a field as it is; a blank clears it to NULL.
          email: blankToNull(data.email),
          phone: blankToNull(data.phone),
          propertyId: data.propertyId,
          rent: data.rent,
          leaseStart: data.leaseStart ? new Date(data.leaseStart) : undefined,
          leaseEnd: data.leaseEnd ? new Date(data.leaseEnd) : undefined,
          // paymentStatus is derived from the RentPeriod ledger (Situs Migration A —
          // lib/services/allocation/service.ts), never accepted here.
          lastPayment: data.lastPayment ? new Date(data.lastPayment) : undefined,
          notes: data.notes,
          // Undefined leaves a field as it is; null, from a blank input, clears it.
          taxId: data.taxId,
          taxCountry: data.taxCountry,
          idDocument: data.idDocument,
        },
        include: { property: true },
      }),
    );
    return withDerived(userId, tenant);
  },

  /** Refused while the tenant has history (`lib/services/database/history.ts`). */
  async delete(userId: string, id: string): Promise<void> {
    await assertTenantHasNoHistory(userId, id);
    await getPrismaClient().tenant.delete({ where: { id, userId } });
  },
};
