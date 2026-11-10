import { sumMoney } from "./money";

/**
 * Which receipts are money received, and which of those are income.
 *
 * Screens added up `Receipt.amount` filtered on `status` alone. Voiding a receipt moves its
 * `lifecycle` to `voided` and reverses its rent allocations, but leaves `status` at `paid`, so a
 * voided payment stayed in every income figure; and a deposit is money held for the tenant, to be
 * returned, not income. The rent ledger (`RentPeriod`, `PaymentAllocation`) is the source of truth
 * for rent; until those screens read it, they apply these two rules so they at least agree.
 */

interface ReceiptLike {
  amount: number;
  status: string;
  type: string;
  lifecycle?: string | null;
}

/** Money that arrived and still stands: paid, and not voided. */
export function isReceived(receipt: ReceiptLike): boolean {
  return receipt.status === "paid" && receipt.lifecycle !== "voided";
}

/** Money received that is the owner's income: everything received except a deposit. */
export function countsAsIncome(receipt: ReceiptLike): boolean {
  return isReceived(receipt) && receipt.type !== "deposit";
}

/** The income among these receipts, summed to the cent. */
export function incomeTotal(receipts: readonly ReceiptLike[]): number {
  return sumMoney(receipts.filter(countsAsIncome).map((receipt) => receipt.amount));
}

/** What these receipts brought in, deposits included, summed to the cent. */
export function receivedTotal(receipts: readonly ReceiptLike[]): number {
  return sumMoney(receipts.filter(isReceived).map((receipt) => receipt.amount));
}
