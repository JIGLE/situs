import type { ReceiptLifecycleState } from "@/lib/services/receipts/lifecycle";

/**
 * Which month a receipt is listed under, and which receipts can be issued.
 *
 * A receipt belongs to the rent month it paid (`referenceMonth`, written when the payment is
 * allocated). One with no rent month, because it is not rent or was never allocated, belongs to
 * the month it was paid.
 */

export interface MonthKey {
  year: number;
  month: number;
}

/** "YYYY-MM" for a month. */
export function monthKeyString({ year, month }: MonthKey): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The month a receipt is listed under, as "YYYY-MM". */
export function receiptMonth(receipt: { referenceMonth?: string | null; date: string }): string {
  return receipt.referenceMonth ?? receipt.date.slice(0, 7);
}

/** The month `delta` months after (or, negative, before) `from`. */
export function shiftMonth(from: MonthKey, delta: number): MonthKey {
  const index = from.year * 12 + (from.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The stages a receipt can be issued from: still a draft, or in review. */
const ISSUABLE: ReadonlySet<string> = new Set<ReceiptLifecycleState>(["draft", "review"]);

export function isIssuable(lifecycle: string | null | undefined): boolean {
  return lifecycle !== null && lifecycle !== undefined && ISSUABLE.has(lifecycle);
}

/** The stages a receipt can be voided from; a filed receipt can only be voided at the Portal. */
const VOIDABLE: ReadonlySet<string> = new Set<ReceiptLifecycleState>([
  "draft",
  "review",
  "emitted",
]);

export function isVoidable(lifecycle: string | null | undefined): boolean {
  return lifecycle !== null && lifecycle !== undefined && VOIDABLE.has(lifecycle);
}
