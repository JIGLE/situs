import { describe, expect, it } from "vitest";

import {
  parseAmount,
  parseBankCsv,
  parseDate,
  redactRowForStorage,
  splitCsvLine,
  type BankCsvRow,
} from "./csv";

describe("splitCsvLine", () => {
  it("splits simple comma lines", () => {
    expect(splitCsvLine("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("respects quoted fields containing the delimiter", () => {
    expect(splitCsvLine('2026-07-01,"Silva, Maria",850.00', ",")).toEqual([
      "2026-07-01",
      "Silva, Maria",
      "850.00",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('"say ""hi""",x', ",")).toEqual(['say "hi"', "x"]);
  });

  it("handles semicolon delimiter", () => {
    expect(splitCsvLine("01/07/2026;850,00;renda julho", ";")).toEqual([
      "01/07/2026",
      "850,00",
      "renda julho",
    ]);
  });
});

describe("parseAmount", () => {
  it("parses plain decimals", () => {
    expect(parseAmount("850.00")).toBe(850);
  });

  it("parses European format 1.234,56", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });

  it("parses Anglo format 1,234.56", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });

  it("parses comma decimals without thousands", () => {
    expect(parseAmount("850,50")).toBe(850.5);
  });

  it("strips currency symbols and spaces", () => {
    expect(parseAmount("€ 1.000,00")).toBe(1000);
  });

  it("parses negative amounts", () => {
    expect(parseAmount("-850,00")).toBe(-850);
  });

  it("rejects garbage", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("passes through ISO dates", () => {
    expect(parseDate("2026-07-01")).toBe("2026-07-01");
  });

  it("parses dd/mm/yyyy", () => {
    expect(parseDate("01/07/2026")).toBe("2026-07-01");
  });

  it("parses dd-mm-yyyy and dd.mm.yyyy", () => {
    expect(parseDate("1-7-2026")).toBe("2026-07-01");
    expect(parseDate("01.07.2026")).toBe("2026-07-01");
  });

  it("rejects impossible months", () => {
    expect(parseDate("01/13/2026")).toBeNull();
    expect(parseDate("julho")).toBeNull();
  });
});

describe("parseBankCsv", () => {
  it("parses a comma CSV with recognized headers", () => {
    const { rows, errors } = parseBankCsv(
      [
        "Date,Amount,Counterparty,IBAN,Reference",
        "2026-07-01,850.00,Maria Silva,PT50000201231234567890154,renda 07/2026",
        "2026-07-02,-120.00,EDP Energia,,fatura",
      ].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      bookingDate: "2026-07-01",
      amount: 850,
      counterpartyName: "Maria Silva",
      counterpartyIban: "PT50000201231234567890154",
      reference: "renda 07/2026",
    });
    expect(rows[1].amount).toBe(-120);
  });

  it("parses a Portuguese semicolon CSV with European amounts", () => {
    const { rows, errors } = parseBankCsv(
      ["Data;Montante;Ordenante;Descritivo", "01/07/2026;1.250,00;Joao Santos;renda julho"].join(
        "\n",
      ),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      bookingDate: "2026-07-01",
      amount: 1250,
      counterpartyName: "Joao Santos",
      reference: "renda julho",
    });
  });

  it("normalizes IBAN whitespace and case", () => {
    const { rows } = parseBankCsv(
      ["date,amount,iban", "2026-07-01,100,pt50 0002 0123 4567 8901 54"].join("\n"),
    );
    expect(rows[0].counterpartyIban).toBe("PT50000201234567890154");
  });

  it("reports bad rows per line and keeps good ones", () => {
    const { rows, errors } = parseBankCsv(
      ["date,amount", "2026-07-01,100", "not-a-date,100", "2026-07-03,zzz"].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Line 3");
    expect(errors[1]).toContain("Line 4");
  });

  it("fails clearly when no date or amount column is present", () => {
    expect(parseBankCsv("foo,bar\n1,2").errors[0]).toContain("date");
    expect(parseBankCsv("date,bar\n2026-07-01,2").errors[0]).toContain("amount");
  });

  it("needs at least a header and one data row", () => {
    expect(parseBankCsv("date,amount").errors).toHaveLength(1);
  });
});

describe("redactRowForStorage", () => {
  const row: BankCsvRow = {
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
