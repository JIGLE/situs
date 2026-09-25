/**
 * One bank movement, as every source hands it to `importBankRows` (`./import.ts`): a live
 * provider's sync (`./providers/`), and in development and E2E, `/api/debug/bank/movements`.
 * Pure, no IO.
 */
export interface BankRow {
  bookingDate: string; // ISO "YYYY-MM-DD"
  valueDate?: string;
  amount: number;
  counterpartyName?: string;
  counterpartyIban?: string;
  reference?: string;
}

/**
 * The imported row as it is safe to persist verbatim, with `counterpartyIban` removed.
 *
 * `BankTransaction.rawData` keeps the original row so an import can be re-read or re-matched
 * later. Serialising the row as-is defeated the encryption one field above it: the IBAN was
 * written AES-256-GCM encrypted into `counterpartyIban`, and then again in clear inside
 * `rawData`, which is an ordinary unencrypted column. Anything that could read the row could
 * read the IBAN, and `/api/debug/db` would have returned it.
 *
 * The IBAN is the only field this drops. `counterpartyName` and `reference` stay, because they
 * are already stored in plaintext columns of their own — omitting them here would hide nothing
 * and lose the fidelity `rawData` exists for. The encrypted `counterpartyIban` column and the
 * `counterpartyIbanHash` carry everything the pipeline actually reads.
 */
export function redactRowForStorage(row: BankRow): Omit<BankRow, "counterpartyIban"> {
  // Destructured out rather than deleted from a copy, so a future field added to BankRow is
  // carried through by `rest` and this keeps compiling.
  const { counterpartyIban: _omitted, ...rest } = row;
  return rest;
}
