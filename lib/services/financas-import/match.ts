/**
 * Matches what a Finanças document names against what the owner already has: a property by its
 * article and fraction, a tenant by NIF. Pure, and safe on the client.
 */
import type { ParsedContract } from "./contract";
import { articleKey, fractionKey, titleCase } from "./text";

export interface MatchableProperty {
  id: string;
  cadasterReference?: string | null;
  fraction?: string | null;
}

export interface MatchableTenant {
  id: string;
  taxId?: string | null;
}

/**
 * The properties with this article and fraction. An article number is unique only within its
 * parish, which Situs does not keep, so two can match; the caller then lets the owner choose.
 */
export function propertiesMatching<P extends MatchableProperty>(
  properties: P[],
  article: string | null | undefined,
  fraction: string | null | undefined,
): P[] {
  const a = articleKey(article);
  if (!a) return [];
  const f = fractionKey(fraction);
  return properties.filter(
    (p) => articleKey(p.cadasterReference) === a && fractionKey(p.fraction) === f,
  );
}

export type TenancyWarning =
  | "property_not_found"
  | "property_ambiguous"
  | "no_tenant"
  | "no_rent"
  | "rent_not_monthly"
  | "no_start";

export interface ImportedTenancy {
  propertyId: string | null;
  /** The first tenant: one already in Situs (by NIF), or a new one to create. */
  tenant: { existingId: string } | { name: string; taxId: string } | null;
  /** The other tenants, as co-tenants on the lease. */
  coTenants: { name: string; taxId: string }[];
  startDate: string | null;
  endDate: string | null;
  monthlyRent: number | null;
  atContractNumber: string | null;
  warnings: TenancyWarning[];
}

/** What the New tenancy sheet fills in from a contract proof, and what it must tell the owner. */
export function tenancyFromContract(
  contract: ParsedContract,
  properties: MatchableProperty[],
  tenants: MatchableTenant[],
  today: string,
): ImportedTenancy {
  const warnings: TenancyWarning[] = [];

  const matches = propertiesMatching(properties, contract.article, contract.fraction);
  if (matches.length === 0) warnings.push("property_not_found");
  if (matches.length > 1) warnings.push("property_ambiguous");

  const [first, ...others] = contract.tenants;
  let tenant: ImportedTenancy["tenant"] = null;
  if (!first) warnings.push("no_tenant");
  else {
    const existing = tenants.find((t) => (t.taxId ?? "").replace(/\s/g, "") === first.taxId);
    tenant = existing
      ? { existingId: existing.id }
      : { name: titleCase(first.name), taxId: first.taxId };
  }

  if (contract.monthlyRent == null) warnings.push("no_rent");
  if (contract.rentNotMonthly) warnings.push("rent_not_monthly");
  if (!contract.startDate) warnings.push("no_start");

  return {
    propertyId: matches.length === 1 ? matches[0].id : null,
    tenant,
    coTenants: others.map((p) => ({ name: titleCase(p.name), taxId: p.taxId })),
    startDate: contract.startDate,
    endDate: currentTermEnd(contract.endDate, today),
    monthlyRent: contract.monthlyRent,
    atContractNumber: contract.contractNumber,
    warnings,
  };
}

/**
 * The end of the term running today. A contract the owner imports is one still in force, so a term
 * Finanças shows as ended has renewed since, as a lease renews by default (art. 1096 CC): it is
 * carried forward a year at a time, the usual term, to the first end on or after today. The owner
 * can change it in the sheet.
 */
export function currentTermEnd(endDate: string | null, today: string): string | null {
  if (!endDate || endDate >= today) return endDate;
  const [year, month, day] = endDate.split("-").map(Number);
  for (let y = year + 1; y <= Number(today.slice(0, 4)) + 1; y++) {
    // 29 February carries to the 28th in a year without it.
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    const end = `${y}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    if (end >= today) return end;
  }
  return null;
}
