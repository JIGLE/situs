/**
 * Portugal — the Autoridade Tributária connector's key.
 *
 * One `TaxAuthorityConnector` row per account carries this key: its mode and the Portal
 * sub-user (`lib/services/tax/at-connection.ts`). Receipts reach AT through its webservice
 * (`lib/tax/at/`), tested from Finance › Recibos (`lib/services/tax/at-receipts.ts`).
 *
 * There is no production filing. The Modelo 44 path that once simulated one (a `RentReceipt`
 * row, its XML, and a submit/poll that marked it accepted) was deleted: the webservice is the one
 * way a receipt will reach Finanças, and going live with it is a code change, not a mode edit.
 */
export const PT_AT_CONNECTOR_KEY = "pt_at_recibos";
