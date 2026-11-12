/**
 * Which contract an uploaded recibo de renda pays, and which month. Pure: the caller reads the
 * leases, with their people's NIFs decrypted, and this decides.
 *
 * A recibo names its tenants by NIF, so a lease is a candidate when one of its tenants (the main
 * one or a co-tenant) has a NIF printed on the recibo. Several candidates are narrowed by the
 * property's article and fraction, then by the contract whose term covers the month, then by an
 * active one. What is still ambiguous, or found nowhere, is left to the owner to pick.
 */
import { articleKey, fractionKey } from "./text";
import type { ParsedRentReceipt } from "./rent-receipt";

export interface ReceiptMatchLease {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  /** Every tenant's NIF on the lease, main tenant first; blanks left out. */
  tenantTaxIds: string[];
  article: string | null;
  fraction: string | null;
}

export interface ReceiptMonth {
  year: number;
  month: number;
}

/** The month the recibo pays: the one its period starts in. */
export function receiptMonth(parsed: Pick<ParsedRentReceipt, "periodStart">): ReceiptMonth | null {
  const match = parsed.periodStart ? /^(\d{4})-(\d{2})/.exec(parsed.periodStart) : null;
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

const digits = (value: string) => value.replace(/\D/g, "");

function narrow<L>(leases: L[], keep: (lease: L) => boolean): L[] {
  const kept = leases.filter(keep);
  return kept.length > 0 ? kept : leases;
}

/**
 * The leases the recibo may pay, best first: one when it is certain, several for the owner to
 * choose from, none when no tenant's NIF is on it.
 */
export function leasesForReceipt<L extends ReceiptMatchLease>(
  parsed: Pick<ParsedRentReceipt, "taxIds" | "article" | "fraction" | "periodStart">,
  leases: L[],
): L[] {
  const printed = new Set(parsed.taxIds.map(digits));
  let found = leases.filter((lease) =>
    lease.tenantTaxIds.some((taxId) => printed.has(digits(taxId))),
  );
  if (found.length <= 1) return found;

  const article = articleKey(parsed.article);
  if (article) {
    found = narrow(
      found,
      (lease) =>
        articleKey(lease.article) === article &&
        (parsed.fraction === null || fractionKey(lease.fraction) === fractionKey(parsed.fraction)),
    );
  }
  const month = parsed.periodStart?.slice(0, 7);
  if (month) {
    found = narrow(
      found,
      (lease) => lease.startDate.slice(0, 7) <= month && lease.endDate.slice(0, 7) >= month,
    );
  }
  return narrow(found, (lease) => lease.status === "active");
}
