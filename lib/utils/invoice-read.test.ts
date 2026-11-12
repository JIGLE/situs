import { describe, expect, it } from "vitest";
import { parseAtQr, readInvoiceText, rememberedSupplier } from "./invoice-read";

// The example layout from AT's QR code specification, with a condomínio's invoice's values.
const QR =
  "A:509876543*B:212345678*C:PT*D:FT*E:N*F:20261105*G:FT 2026/318*H:JJ3NXX9P-318*I1:PT*I7:36.59*I8:8.41*N:8.41*O:45.00*Q:hYz1*R:1234";

describe("parseAtQr", () => {
  it("reads the supplier, the buyer, the day and the total", () => {
    expect(parseAtQr(QR)).toEqual({
      supplierNif: "509876543",
      buyerNif: "212345678",
      date: "2026-11-05",
      total: 45,
      vat: 8.41,
      documentNumber: "FT 2026/318",
      atcud: "JJ3NXX9P-318",
      source: "qr",
    });
  });

  it("is not fooled by another QR code", () => {
    expect(parseAtQr("https://example.com/menu")).toBeNull();
    expect(parseAtQr("A:12*F:20260101*O:1.00")).toBeNull();
  });

  it("keeps the buyer as printed and drops an ATCUD of 0", () => {
    const fields = parseAtQr("A:509876543*B:999999990*F:20260301*H:0*O:12.30");
    expect(fields?.buyerNif).toBe("999999990");
    expect(fields?.atcud).toBeUndefined();
  });
});

describe("readInvoiceText", () => {
  const invoice = [
    `Águas do Porto, EM
     NIF: 507718666
     Fatura FT 2026/88123   Data: 04-11-2026
     Cliente: José Silva  Contribuinte: 212345678
     Consumo água  18,20
     Total Ilíquido 17,17
     Total IVA 1,03
     Total 18,20 €
     ATCUD: AB12CD34-88123`,
  ];

  it("reads the total that is not a tax line, the date and the NIFs in order", () => {
    expect(readInvoiceText(invoice)).toEqual({
      supplierNif: "507718666",
      buyerNif: "212345678",
      date: "2026-11-04",
      total: 18.2,
      atcud: "AB12CD34-88123",
      source: "text",
    });
  });

  it("reads thousands written the Portuguese way", () => {
    expect(readInvoiceText(["Total a pagar: 1.234,56"]).total).toBe(1234.56);
  });

  it("leaves out what it cannot find", () => {
    expect(readInvoiceText(["Obrigado pela preferência"])).toEqual({ source: "text" });
  });
});

describe("rememberedSupplier", () => {
  it("takes the newest expense paid to the same NIF", () => {
    const expenses = [
      { vendorVat: "507718666", category: "water", propertyId: "p1", date: "2026-09-01" },
      {
        vendorVat: "PT 507 718 666",
        vendorName: "Águas do Porto",
        category: "water",
        propertyId: "p2",
        date: "2026-10-01",
      },
      { vendorVat: "500000000", category: "gas", propertyId: "p3", date: "2026-11-01" },
    ];
    expect(rememberedSupplier(expenses, "507718666")).toEqual({
      vendorName: "Águas do Porto",
      category: "water",
      propertyId: "p2",
      isDeductible: undefined,
    });
    expect(rememberedSupplier(expenses, "123456789")).toBeNull();
    expect(rememberedSupplier(expenses, undefined)).toBeNull();
  });
});
