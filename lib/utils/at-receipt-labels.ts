import type { AtReceiptRefusal } from "@/lib/services/tax/at-receipts";
import type { AtReceiptBlockerCode } from "@/lib/tax/at/receipt-request";

/**
 * Keys, under `financial.receipts.atSheet`, for what stops a receipt going to Finanças. A stored
 * code is not a label, and the `Record` types make a new code without a sentence a compile error.
 */
export const AT_BLOCKER_KEY = {
  contract_number_missing: "blocker.contractNumberMissing",
  contract_number_invalid: "blocker.contractNumberInvalid",
  landlord_missing: "blocker.landlordMissing",
  landlord_nif_missing: "blocker.landlordNifMissing",
  landlord_nif_invalid: "blocker.landlordNifInvalid",
  tenant_missing: "blocker.tenantMissing",
  tenant_nif_missing: "blocker.tenantNifMissing",
  tenant_nif_invalid: "blocker.tenantNifInvalid",
  tenant_entity: "blocker.tenantEntity",
  tenant_document_missing: "blocker.tenantDocumentMissing",
  amount_not_positive: "blocker.amountNotPositive",
  received_in_future: "blocker.receivedInFuture",
} as const satisfies Record<AtReceiptBlockerCode, string>;

export const AT_REFUSAL_KEY = {
  not_issuable: "refusal.notIssuable",
  not_rent: "refusal.notRent",
  not_paid: "refusal.notPaid",
  no_rent_month: "refusal.noRentMonth",
} as const satisfies Record<AtReceiptRefusal, string>;
