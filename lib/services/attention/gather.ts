/**
 * What the owner still has to give Situs: the active leases, the people on them and what is
 * missing (`rules.ts` decides). Every read is scoped to the owner.
 *
 * People are read through their own models, never nested under a lease or a property, so the PII
 * extension decrypts their NIFs: owners through `owner`, tenants through `tenant`. A nested
 * `include` would hand back the NIF still encrypted, and an encrypted string is "not empty", so
 * the list would call a NIF good that nobody can read.
 *
 * Only active leases are looked at: an ended or draft contract needs no receipt.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { attentionCounts, attentionItems, type Attention, type AttentionLease } from "./rules";

const unique = <T>(values: T[]) => [...new Set(values)];

export async function loadAttentionLeases(userId: string): Promise<AttentionLease[]> {
  const prisma = getPrismaClient();

  const leases = await prisma.lease.findMany({
    where: { userId, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true, propertyId: true, tenantId: true, atContractNumber: true },
  });
  if (leases.length === 0) return [];

  const propertyIds = unique(leases.map((lease) => lease.propertyId));
  const [properties, shares, tenants] = await Promise.all([
    prisma.property.findMany({
      where: { userId, id: { in: propertyIds } },
      select: { id: true, name: true },
    }),
    prisma.propertyOwner.findMany({
      where: { propertyId: { in: propertyIds }, property: { userId } },
      select: { propertyId: true, ownerId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tenant.findMany({
      where: { userId, id: { in: unique(leases.map((lease) => lease.tenantId)) } },
      select: { id: true, name: true, taxId: true, taxCountry: true, idDocument: true },
    }),
  ]);
  const owners = await prisma.owner.findMany({
    where: { userId, id: { in: unique(shares.map((share) => share.ownerId)) } },
    select: { id: true, name: true, taxIdentificationNumber: true },
  });

  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

  return leases.flatMap((lease): AttentionLease[] => {
    const property = propertyById.get(lease.propertyId);
    const tenant = tenantById.get(lease.tenantId);
    if (!property || !tenant) return [];

    const landlords = shares
      .filter((share) => share.propertyId === lease.propertyId)
      .flatMap((share) => {
        const owner = ownerById.get(share.ownerId);
        return owner
          ? [{ id: owner.id, name: owner.name, nif: owner.taxIdentificationNumber }]
          : [];
      });

    return [
      {
        id: lease.id,
        property: property.name,
        contractNumber: lease.atContractNumber,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          nif: tenant.taxId,
          country: tenant.taxCountry,
          document: tenant.idDocument,
        },
        landlords,
      },
    ];
  });
}

export async function getAttention(userId: string): Promise<Attention> {
  const items = attentionItems(await loadAttentionLeases(userId));
  return { items, counts: attentionCounts(items) };
}
