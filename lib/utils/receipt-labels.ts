import type { Receipt } from "@/lib/types";
import type { ReceiptLifecycleState } from "@/lib/services/receipts/lifecycle";

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
export const RECEIPT_TYPE_KEY = {
  rent: "typeRent",
  deposit: "typeDeposit",
  maintenance: "typeMaintenance",
  other: "typeOther",
} as const satisfies Record<Receipt["type"], string>;

/**
 * Catalogue key for a receipt's document stage, under `financial.receipts`. Every
 * `ReceiptLifecycleState`, so a new stage without a label is a compile error rather than a
 * stored word shown as itself.
 */
export const RECEIPT_LIFECYCLE_KEY = {
  draft: "lifecycle.draft",
  review: "lifecycle.review",
  emitted: "lifecycle.emitted",
  submitted: "lifecycle.submitted",
  accepted: "lifecycle.accepted",
  rejected: "lifecycle.rejected",
  voided: "lifecycle.voided",
} as const satisfies Record<ReceiptLifecycleState, string>;

/** The key for a stage as the API sends it (text), or null for one nothing writes. */
export function receiptLifecycleKey(
  state: string | null | undefined,
): (typeof RECEIPT_LIFECYCLE_KEY)[ReceiptLifecycleState] | null {
  return state && Object.hasOwn(RECEIPT_LIFECYCLE_KEY, state)
    ? RECEIPT_LIFECYCLE_KEY[state as ReceiptLifecycleState]
    : null;
}
