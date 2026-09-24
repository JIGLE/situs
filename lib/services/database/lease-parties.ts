import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "./database";
import { blankToNull, normalizeTaxId } from "@/lib/schemas/tax-identity";
import type { LeaseParty } from "@/lib/types";

/**
 * A lease's co-tenants and guarantors: everyone on it besides its main tenant.
 *
 * Always read and written through `leaseParty` itself, never nested under a lease. The PII
 * extension encrypts and decrypts only the queried model's own fields, so a nested create would
 * store the NIF in clear and a nested include would return it still encrypted.
 */

export interface LeasePartyInput {
  role: "tenant" | "guarantor";
  name: string;
  taxId?: string | null;
  taxCountry?: string | null;
  idDocument?: string | null;
}

type LeasePartyDb = Pick<Prisma.TransactionClient, "leaseParty">;

/**
 * Replace a lease's parties with these. Pass the transaction the lease is written in, so a lease
 * never ends up with half its parties.
 */
export async function replaceLeaseParties(
  db: LeasePartyDb,
  userId: string,
  leaseId: string,
  parties: LeasePartyInput[],
): Promise<void> {
  await db.leaseParty.deleteMany({ where: { userId, leaseId } });
  if (parties.length === 0) return;
  await db.leaseParty.createMany({
    data: parties.map((party) => {
      const taxCountry = party.taxCountry || "PT";
      return {
        userId,
        leaseId,
        role: party.role,
        name: party.name,
        taxCountry,
        taxId: normalizeTaxId(party.taxId, taxCountry) ?? null,
        idDocument: blankToNull(party.idDocument) ?? null,
      };
    }),
  });
}

/** The parties of these leases, by lease id, oldest first. */
export async function partiesByLease(
  userId: string,
  leaseIds: string[],
): Promise<Map<string, LeaseParty[]>> {
  const byLease = new Map<string, LeaseParty[]>();
  if (leaseIds.length === 0) return byLease;

  const rows = await getPrismaClient().leaseParty.findMany({
    where: { userId, leaseId: { in: leaseIds } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      leaseId: true,
      role: true,
      name: true,
      taxId: true,
      taxCountry: true,
      idDocument: true,
    },
  });
  for (const { leaseId, ...party } of rows) {
    const list = byLease.get(leaseId) ?? [];
    list.push(party);
    byLease.set(leaseId, list);
  }
  return byLease;
}
