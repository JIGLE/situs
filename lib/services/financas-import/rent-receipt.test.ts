import { describe, expect, it } from "vitest";

import { parseRentReceipt } from "./rent-receipt";

// Valid NIFs (check digit passes): landlord 123456789, tenant 234567899.
const INLINE = [
  "RECIBO DE RENDA ELETRÓNICO Original RECIBO DE RENDA N.º 27 DATA DE EMISSÃO 2026-03-05",
  "EMITENTE LOCADOR/SUBLOCADOR (SENHORIO)/CEDENTE NOME JOSE EXEMPLO NIF 123456789",
  "LOCATÁRIO/SUBLOCATÁRIO (INQUILINO)/CESSIONÁRIO NOME ANA SILVA NIF 234567899",
  "IDENTIFICAÇÃO DO IMÓVEL Localização / Morada RUA CAPITAO LEITAO 9 2 ESQ",
  "Freguesia Tipo Artigo Fração/Secção 110654 U 1234 C TIPO DE CONTRATO Arrendamento",
  "RENDA Período a que respeita a renda 2026-03-01 a 2026-03-31",
  "Valor 750,00 € Retenção de IRS 0,00 € Importância Recebida 750,00 €",
  "IMPORTANCIA RECEBIDA A TÍTULO DE: Renda Data de recebimento: 2026-03-04",
  "Documento emitido eletronicamente.",
].join(" ");

// The same recibo with its values drawn after every label, as a filled PDF may lay them out.
const DRAWN_APART = [
  "RECIBO DE RENDA ELETRÓNICO RECIBO DE RENDA N.º DATA DE EMISSÃO EMITENTE",
  "LOCADOR/SUBLOCADOR (SENHORIO)/CEDENTE NOME NIF LOCATÁRIO/SUBLOCATÁRIO (INQUILINO)/CESSIONÁRIO",
  "NOME NIF IDENTIFICAÇÃO DO IMÓVEL Freguesia Tipo Artigo Fração/Secção",
  "Período a que respeita a renda a Valor € Retenção de IRS € Importância Recebida €",
  "IMPORTANCIA RECEBIDA A TÍTULO DE: Renda Caução Adiantamento Data de recebimento:",
  "27 2026-03-05 JOSE EXEMPLO 123456789 ANA SILVA 234567899 110654 U 1234 C",
  "2026-03-01 2026-03-31 1.000,00 250,00 750,00 2026-03-04",
].join(" ");

describe("parseRentReceipt", () => {
  it("reads a recibo whose values sit beside their labels", () => {
    expect(parseRentReceipt([INLINE])).toEqual({
      recognised: true,
      number: "27",
      issuedOn: "2026-03-05",
      receivedOn: "2026-03-04",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      rent: 750,
      withheld: null,
      received: 750,
      taxIds: ["123456789", "234567899"],
      article: "1234",
      fraction: "C",
    });
  });

  it("reads the amounts that add up when they are drawn apart from their labels", () => {
    const read = parseRentReceipt([DRAWN_APART]);
    expect(read).toMatchObject({
      recognised: true,
      rent: 1000,
      withheld: 250,
      received: 750,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      receivedOn: "2026-03-04",
      taxIds: ["123456789", "234567899"],
      article: "1234",
      fraction: "C",
    });
  });

  it("reads a period written day first", () => {
    const read = parseRentReceipt([
      "RECIBO DE RENDA ELETRÓNICO Período a que respeita a renda de 01-02-2026 a 28-02-2026 Valor 500,00 €",
    ]);
    expect(read.periodStart).toBe("2026-02-01");
    expect(read.periodEnd).toBe("2026-02-28");
    expect(read.rent).toBe(500);
  });

  it("does not take a document that is not a recibo for one", () => {
    const read = parseRentReceipt(["CADERNETA PREDIAL URBANA Artigo matricial 1234"]);
    expect(read.recognised).toBe(false);
    expect(read.periodStart).toBeNull();
  });

  it("ignores nine-digit numbers that are not NIFs", () => {
    const read = parseRentReceipt(["RECIBO DE RENDA NIF 123456780 NIF 234567899"]);
    expect(read.taxIds).toEqual(["234567899"]);
  });
});
