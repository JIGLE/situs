/**
 * What the owner still has to give Situs, as a list: the fields a receipt for a rent month needs,
 * and which of them are missing or not good enough. Pure: `gather.ts` reads the records, this
 * decides.
 *
 * It asks the receipt review's own questions (`receiptBlockers`'s checks, exported from
 * `lib/tax/at/receipt-request.ts`), so the two cannot disagree about what is valid: a contract
 * number the review accepts is never listed here, and one it refuses always is.
 *
 * Only a field the owner can fill in is an item. A company tenant also stops a receipt, since
 * withholding is not sent yet, but there is nothing to type in; the review says so where it
 * matters, so it stays out of this list.
 *
 * Co-tenants are not listed yet. They are replaced as a group with their lease, so answering for
 * one is a different kind of save from the others here.
 */

import {
  contractNumberBlocker,
  landlordBlockers,
  tenantBlockers,
  type AtLandlord,
  type AtTenant,
} from "@/lib/tax/at/receipt-request";

/** The fields, in the order the owner would fix them: the review lists its blockers in this order. */
export const ATTENTION_KINDS = [
  "contract_number",
  "landlord_nif",
  "tenant_nif",
  "tenant_document",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/**
 * How much it matters, most first. The owner asked for this order: what stops a receipt at
 * Finanças, then what reminders and matching need, then the rest.
 */
export const ATTENTION_WEIGHTS = ["blocks_receipt", "reminders", "nice_to_have"] as const;

export type AttentionWeight = (typeof ATTENTION_WEIGHTS)[number];

const KIND_WEIGHT: Record<AttentionKind, AttentionWeight> = {
  contract_number: "blocks_receipt",
  landlord_nif: "blocks_receipt",
  tenant_nif: "blocks_receipt",
  tenant_document: "blocks_receipt",
};

/** Which record the answer is saved on. */
export type AttentionRecordType = "lease" | "owner" | "tenant";

const KIND_RECORD: Record<AttentionKind, AttentionRecordType> = {
  contract_number: "lease",
  landlord_nif: "owner",
  tenant_nif: "tenant",
  tenant_document: "tenant",
};

export interface AttentionItem {
  /** The kind and the record, so a skipped item is still the same one after a refetch. */
  id: string;
  kind: AttentionKind;
  weight: AttentionWeight;
  record: { type: AttentionRecordType; id: string };
  /** Who it is about: the tenant for a lease's contract number, the person otherwise. */
  name: string;
  /** The property that gives the question its place, such as "T2 na Rua Augusta". */
  property: string | null;
  /** `invalid` is a value that is stored and refused, which the owner has to replace. */
  problem: "missing" | "invalid";
  /** What is stored, when there is something and it is not good enough. */
  current: string | null;
}

export interface AttentionLease {
  id: string;
  /** The property's name. */
  property: string;
  contractNumber: string | null;
  tenant: { id: string } & AtTenant;
  /** Who the receipt names as landlord: the property's owners. */
  landlords: ({ id: string } & AtLandlord)[];
}

export interface AttentionCounts {
  total: number;
  blocksReceipt: number;
  reminders: number;
  niceToHave: number;
}

const COUNT_KEY: Record<AttentionWeight, keyof Omit<AttentionCounts, "total">> = {
  blocks_receipt: "blocksReceipt",
  reminders: "reminders",
  nice_to_have: "niceToHave",
};

const problemOf = (code: string): AttentionItem["problem"] =>
  code.endsWith("_invalid") ? "invalid" : "missing";

/** What is missing across the active leases, each field once however many leases share it. */
export function attentionItems(leases: AttentionLease[]): AttentionItem[] {
  const items = new Map<string, AttentionItem>();

  const add = (
    kind: AttentionKind,
    recordId: string,
    name: string,
    property: string,
    code: string,
    current: string | null,
  ) => {
    const id = `${kind}:${recordId}`;
    if (items.has(id)) return;
    items.set(id, {
      id,
      kind,
      weight: KIND_WEIGHT[kind],
      record: { type: KIND_RECORD[kind], id: recordId },
      name,
      property,
      problem: problemOf(code),
      current: current?.trim() || null,
    });
  };

  for (const lease of leases) {
    const contract = contractNumberBlocker(lease.contractNumber);
    if (contract) {
      add(
        "contract_number",
        lease.id,
        lease.tenant.name,
        lease.property,
        contract,
        lease.contractNumber,
      );
    }

    for (const landlord of lease.landlords) {
      for (const blocker of landlordBlockers(landlord)) {
        add("landlord_nif", landlord.id, landlord.name, lease.property, blocker.code, landlord.nif);
      }
    }

    const { tenant } = lease;
    for (const blocker of tenantBlockers(tenant)) {
      switch (blocker.code) {
        case "tenant_nif_missing":
        case "tenant_nif_invalid":
          add("tenant_nif", tenant.id, tenant.name, lease.property, blocker.code, tenant.nif);
          break;
        case "tenant_document_missing":
          add(
            "tenant_document",
            tenant.id,
            tenant.name,
            lease.property,
            blocker.code,
            tenant.document,
          );
          break;
        default:
          // A company tenant: nothing to type in, so nothing to list. The review says it.
          break;
      }
    }
  }

  const weightRank = (item: AttentionItem) => ATTENTION_WEIGHTS.indexOf(item.weight);
  const kindRank = (item: AttentionItem) => ATTENTION_KINDS.indexOf(item.kind);
  return [...items.values()].sort(
    (a, b) =>
      weightRank(a) - weightRank(b) ||
      kindRank(a) - kindRank(b) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function attentionCounts(items: AttentionItem[]): AttentionCounts {
  const counts: AttentionCounts = {
    total: items.length,
    blocksReceipt: 0,
    reminders: 0,
    niceToHave: 0,
  };
  for (const item of items) counts[COUNT_KEY[item.weight]] += 1;
  return counts;
}
