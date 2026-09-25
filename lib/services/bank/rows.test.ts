import { describe, expect, it } from "vitest";

import { redactRowForStorage, type BankRow } from "./rows";

describe("redactRowForStorage", () => {
  const row: BankRow = {
    bookingDate: "2026-07-01",
    valueDate: "2026-07-02",
    amount: 850,
    counterpartyName: "Maria Silva",
    counterpartyIban: "PT50000201231234567890154",
    reference: "RENDA 2026-07",
  };

  it("drops counterpartyIban", () => {
    const redacted = redactRowForStorage(row);
    expect(redacted).not.toHaveProperty("counterpartyIban");
  });

  it("does not leave the IBAN anywhere in the serialised form", () => {
    // This is the assertion that matters: `rawData` is a JSON string, so a nested or renamed
    // copy would still be a plaintext IBAN at rest.
    expect(JSON.stringify(redactRowForStorage(row))).not.toContain("PT50000201231234567890154");
  });

  it("keeps every other field, so rawData stays useful for re-matching", () => {
    expect(redactRowForStorage(row)).toEqual({
      bookingDate: "2026-07-01",
      valueDate: "2026-07-02",
      amount: 850,
      counterpartyName: "Maria Silva",
      reference: "RENDA 2026-07",
    });
  });

  it("handles a row that never had an IBAN", () => {
    const { counterpartyIban: _drop, ...without } = row;
    expect(redactRowForStorage(without)).toEqual(without);
  });
});
