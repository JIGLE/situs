import { getPrismaClient } from "@/lib/services/database/database";
import { assertOwnsRelations } from "@/lib/services/database/assert-owned";
import { replaceLeaseParties } from "@/lib/services/database/lease-parties";
import { blankToNull, normalizeTaxId } from "@/lib/schemas/tax-identity";
import { logAudit } from "@/lib/services/audit-log";
import type { ContractImport } from "./schema";

/**
 * Write a reviewed contract: its property, owners and their shares, main tenant, lease, the
 * lease's other parties and its clauses, in one transaction. Nothing is written before the owner
 * confirms, and a failure part-way leaves nothing behind.
 *
 * Existing records are linked and never edited: a matched property keeps its details and, if it
 * has owners, its shares; a matched tenant keeps theirs. Every id the review sends is checked to
 * be the caller's first, as every other write in the app does (assertOwnsRelations).
 *
 * The contract PDF itself is not here. The sheet uploads it to the new lease's contract route,
 * which encrypts it, once this returns.
 */

export interface ImportedContract {
  leaseId: string;
  propertyId: string;
  tenantId: string;
}

export async function importContract(
  userId: string,
  input: ContractImport,
): Promise<ImportedContract> {
  const prisma = getPrismaClient();

  await Promise.all([
    input.property.mode === "existing"
      ? assertOwnsRelations(userId, { propertyId: input.property.id })
      : undefined,
    input.tenant.mode === "existing"
      ? assertOwnsRelations(userId, { tenantId: input.tenant.id })
      : undefined,
    ...input.landlords.map((landlord) =>
      landlord.mode === "existing"
        ? assertOwnsRelations(userId, { ownerId: landlord.id })
        : undefined,
    ),
  ]);

  const { lease: terms } = input;
  const startDate = new Date(terms.startDate);
  const endDate = new Date(terms.endDate);

  const imported = await prisma.$transaction(async (tx) => {
    const { property } = input;
    const propertyId =
      property.mode === "existing"
        ? property.id
        : (
            await tx.property.create({
              data: {
                userId,
                name: property.name,
                address: property.address,
                zipCode: blankToNull(property.zipCode) ?? null,
                city: blankToNull(property.city) ?? null,
                cadasterReference: blankToNull(property.cadasterReference) ?? null,
                fraction: blankToNull(property.fraction) ?? null,
                type: property.type,
                bedrooms: property.bedrooms,
                bathrooms: property.bathrooms,
                rent: terms.monthlyRent,
                status: "occupied",
              },
              select: { id: true },
            })
          ).id;

    // Shares are written only where the property has none: an owned property's ownership is
    // managed on the property, and a contract is no reason to rewrite it.
    const alreadyOwned =
      property.mode === "existing" && (await tx.propertyOwner.count({ where: { propertyId } })) > 0;
    let owners = 0;
    if (!alreadyOwned) {
      for (const landlord of input.landlords) {
        const ownerId =
          landlord.mode === "existing"
            ? landlord.id
            : (
                await tx.owner.create({
                  data: {
                    userId,
                    name: landlord.name,
                    email: landlord.email,
                    taxResidenceCountry: landlord.taxCountry || "PT",
                    taxIdentificationNumber:
                      normalizeTaxId(landlord.taxId, landlord.taxCountry) ?? null,
                  },
                  select: { id: true },
                })
              ).id;
        await tx.propertyOwner.create({
          data: { propertyId, ownerId, ownershipPercentage: landlord.share },
        });
        owners += 1;
      }
    }

    const { tenant } = input;
    const tenantId =
      tenant.mode === "existing"
        ? tenant.id
        : (
            await tx.tenant.create({
              data: {
                userId,
                name: tenant.name,
                email: tenant.email,
                phone: tenant.phone?.trim() ?? "",
                propertyId,
                rent: terms.monthlyRent,
                leaseStart: startDate,
                leaseEnd: endDate,
                taxCountry: tenant.taxCountry || "PT",
                taxId: normalizeTaxId(tenant.taxId, tenant.taxCountry) ?? null,
                idDocument: blankToNull(tenant.idDocument) ?? null,
              },
              select: { id: true },
            })
          ).id;

    const lease = await tx.lease.create({
      data: {
        userId,
        propertyId,
        tenantId,
        startDate,
        endDate,
        monthlyRent: terms.monthlyRent,
        deposit: terms.deposit,
        autoRenew: terms.autoRenew,
        renewalNoticeDays: terms.renewalNoticeDays,
        atContractNumber: terms.atContractNumber || null,
        atContractVersion: terms.atContractVersion ?? null,
        status: "active",
      },
      select: { id: true },
    });

    await replaceLeaseParties(tx, userId, lease.id, input.parties);
    if (input.clauses.length > 0) {
      await tx.leaseClause.createMany({
        data: input.clauses.map((clause) => ({
          userId,
          leaseId: lease.id,
          kind: clause.kind,
          summary: clause.summary,
          quote: clause.quote,
          page: clause.page ?? null,
        })),
      });
    }

    return { leaseId: lease.id, propertyId, tenantId, owners };
  });

  // The reference-month ledger, seeded as POST /api/leases seeds it: idempotent, and never a
  // reason to fail an import that has already been written.
  try {
    const { generateRentPeriods } = await import("@/lib/services/allocation/service");
    await generateRentPeriods(imported.leaseId);
  } catch {
    // The ledger regenerates on the next allocation.
  }

  await logAudit({
    userId,
    action: "IMPORT_LEASE_CONTRACT",
    resourceType: "Lease",
    resourceId: imported.leaseId,
    details: {
      propertyId: imported.propertyId,
      tenantId: imported.tenantId,
      newProperty: input.property.mode === "new",
      newTenant: input.tenant.mode === "new",
      owners: imported.owners,
      parties: input.parties.length,
      clauses: input.clauses.length,
    },
  });

  return {
    leaseId: imported.leaseId,
    propertyId: imported.propertyId,
    tenantId: imported.tenantId,
  };
}
