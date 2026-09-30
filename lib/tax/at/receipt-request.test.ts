import { describe, expect, it } from "vitest";
import {
  buildReceiptRequest,
  monthBounds,
  receiptBlockers,
  type AtReceiptInput,
} from "./receipt-request";

/**
 * The request for one month's receipt, as the manual names its fields (§4.1), and what stops it.
 * NIFs here pass their check digit: 123456789 and 234567899 are individuals', 451234561 a
 * non-resident individual's, 501234560 a company's.
 */

function input(overrides: Partial<AtReceiptInput> = {}): AtReceiptInput {
  return {
    contractNumber: "1234567",
    contractVersion: 2,
    landlords: [{ name: "Ana Senhoria", nif: "123456789" }],
    tenants: [{ name: "Rui Inquilino", nif: "234567899", country: "PT", document: null }],
    year: 2026,
    month: 9,
    amount: 750,
    receivedOn: "2026-09-03",
    today: "2026-09-27",
    ...overrides,
  };
}

const codes = (overrides: Partial<AtReceiptInput>) =>
  receiptBlockers(input(overrides)).map((blocker) => blocker.code);

describe("buildReceiptRequest", () => {
  it("fills every field the manual asks for, from the lease, the people and the month", () => {
    const result = buildReceiptRequest(
      input({
        landlords: [
          { name: "Ana Senhoria", nif: "123456789" },
          { name: "Luís Senhorio", nif: "234567899" },
        ],
        tenants: [
          { name: "Rui Inquilino", nif: "234567899", country: "PT", document: null },
          { name: "Marie Colocataire", nif: "FR123", country: "FR", document: " 12AB34567 " },
        ],
      }),
      "123456789",
    );

    expect(result).toEqual({
      ok: true,
      fields: {
        numeroContrato: "1234567",
        versaoContrato: 2,
        nifEmitente: "123456789",
        locadores: [{ nif: "123456789" }, { nif: "234567899" }],
        // A Portuguese tenant by NIF; a foreign one by the document, never the foreign tax number.
        locatarios: [
          { nif: "234567899", pais: "PT" },
          { docIdentificacao: "12AB34567", pais: "FR" },
        ],
        tipo: "ARREND",
        dataInicio: "2026-09-01",
        dataFim: "2026-09-30",
        tipoImportancia: "RENDAC",
        valor: "750.00",
        dataRecebimento: "2026-09-03",
      },
    });
  });

  it("leaves the version out for a contract that has none", () => {
    const result = buildReceiptRequest(input({ contractVersion: null }), "123456789");

    expect(result.ok && "versaoContrato" in result.fields).toBe(false);
  });

  it("sends the amount with two decimals and a dot, rounded to the cent", () => {
    const valor = (amount: number) => {
      const result = buildReceiptRequest(input({ amount }), "123456789");
      return result.ok ? result.fields.valor : null;
    };

    expect(valor(750)).toBe("750.00");
    expect(valor(333.333)).toBe("333.33");
    expect(valor(0.1 + 0.2)).toBe("0.30");
  });

  it("takes a tenant without a country as Portuguese", () => {
    const result = buildReceiptRequest(
      input({ tenants: [{ name: "Rui", nif: "234567899", country: null, document: null }] }),
      "123456789",
    );

    expect(result.ok && result.fields.locatarios).toEqual([{ nif: "234567899", pais: "PT" }]);
  });

  it("builds nothing when something blocks the month, and says what", () => {
    const result = buildReceiptRequest(input({ contractNumber: null }), "123456789");

    expect(result).toEqual({ ok: false, blockers: [{ code: "contract_number_missing" }] });
  });
});

describe("monthBounds", () => {
  it("gives the first and last day of the month", () => {
    expect(monthBounds(2026, 9)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthBounds(2026, 12)).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(monthBounds(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds(2028, 2)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
});

describe("receiptBlockers", () => {
  it("passes a month with everything AT needs", () => {
    expect(receiptBlockers(input())).toEqual([]);
  });

  it("needs AT's contract number, in digits", () => {
    expect(codes({ contractNumber: null })).toEqual(["contract_number_missing"]);
    expect(codes({ contractNumber: "  " })).toEqual(["contract_number_missing"]);
    expect(codes({ contractNumber: "123-456" })).toEqual(["contract_number_invalid"]);
    expect(codes({ contractNumber: "1".repeat(19) })).toEqual(["contract_number_invalid"]);
  });

  it("needs a landlord, each with a valid NIF, and names the one without", () => {
    expect(codes({ landlords: [] })).toEqual(["landlord_missing"]);
    expect(
      receiptBlockers(
        input({
          landlords: [
            { name: "Ana", nif: null },
            { name: "Luís", nif: "123456780" },
          ],
        }),
      ),
    ).toEqual([
      { code: "landlord_nif_missing", name: "Ana" },
      { code: "landlord_nif_invalid", name: "Luís" },
    ]);
  });

  it("needs a Portuguese tenant's valid NIF, and a foreign tenant's document", () => {
    const tenant = (nif: string | null, country: string | null, document: string | null) =>
      receiptBlockers(input({ tenants: [{ name: "Rui", nif, country, document }] }));

    expect(codes({ tenants: [] })).toEqual(["tenant_missing"]);
    expect(tenant(null, "PT", "CC 12345678")).toEqual([
      { code: "tenant_nif_missing", name: "Rui" },
    ]);
    expect(tenant("234567890", "PT", null)).toEqual([{ code: "tenant_nif_invalid", name: "Rui" }]);
    expect(tenant("FR123", "FR", null)).toEqual([{ code: "tenant_document_missing", name: "Rui" }]);
    expect(tenant(null, "FR", "   ")).toEqual([{ code: "tenant_document_missing", name: "Rui" }]);
    expect(tenant(null, "FR", "12AB34567")).toEqual([]);
  });

  it("refuses a company tenant, whose withholding is not sent yet, but not a non-resident", () => {
    const tenant = (nif: string) =>
      receiptBlockers(
        input({ tenants: [{ name: "Empresa", nif, country: "PT", document: null }] }),
      );

    expect(tenant("501234560")).toEqual([{ code: "tenant_entity", name: "Empresa" }]);
    expect(tenant("451234561")).toEqual([]);
  });

  it("needs an amount above zero once rounded to the cent", () => {
    expect(codes({ amount: 0 })).toEqual(["amount_not_positive"]);
    expect(codes({ amount: -5 })).toEqual(["amount_not_positive"]);
    expect(codes({ amount: 0.004 })).toEqual(["amount_not_positive"]);
    expect(codes({ amount: 0.01 })).toEqual([]);
  });

  it("refuses money received after today, and takes money received today", () => {
    expect(codes({ receivedOn: "2026-09-28" })).toEqual(["received_in_future"]);
    expect(codes({ receivedOn: "2026-09-27" })).toEqual([]);
  });

  it("lists every blocker at once, so one review fixes them all", () => {
    expect(
      codes({
        contractNumber: null,
        landlords: [],
        tenants: [],
        amount: 0,
        receivedOn: "2027-01-01",
      }),
    ).toEqual([
      "contract_number_missing",
      "landlord_missing",
      "tenant_missing",
      "amount_not_positive",
      "received_in_future",
    ]);
  });
});
