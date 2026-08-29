import type { Receipt } from "@/lib/types";

/**
 * Catalogue key for a receipt's stored type, under the `financial.receipts` namespace.
 *
 * Extracted rather than copied. `receipts-view.tsx` already held this map inline, and the lease
 * detail view — which shows the same receipts, in the same list shape — rendered the raw enum
 * instead: a payment history reading "rent" and "paid" in lowercase English inside a Portuguese
 * screen. Two components displaying one enum is exactly the arrangement that lets the second one
 * drift, so the mapping lives in one place and the `Record` type makes a new `ReceiptType` a
 * compile error rather than a word that renders as itself.
 */
export const RECEIPT_TYPE_KEY: Record<Receipt["type"], string> = {
  rent: "typeRent",
  deposit: "typeDeposit",
  maintenance: "typeMaintenance",
  other: "typeOther",
};
