import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { jsPDF } from "jspdf";

/**
 * Reading a Finanças PDF. The documents are built here with jsPDF and go through the real text
 * extraction, so a change in how `unpdf` lays out a page's text shows up as a wrong field.
 */

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireOwnerAccess: vi.fn(async () => ({ userId: "user-1", scopeUserId: "user-1" })),
  handleOptions: vi.fn(),
}));

import { POST } from "./route";
import { requireOwnerAccess } from "@/lib/services/auth/auth-middleware";

/** A PDF whose pages carry these lines, in this order. A line wider than the page is cut. */
function pdfOf(pages: string[][]): Uint8Array {
  const doc = new jsPDF();
  pages.forEach((lines, i) => {
    if (i > 0) doc.addPage();
    lines.forEach((line, j) => doc.text(line, 10, 15 + j * 8));
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

const send = (kind: string, body: Uint8Array) =>
  POST(
    new NextRequest(`http://localhost:3000/api/financas-import?kind=${kind}`, {
      method: "POST",
      body: new Uint8Array(body),
      headers: { "Content-Type": "application/pdf" },
    }),
  );

const CADERNETA = pdfOf([
  [
    "110664 - ARROIOS - U - 1234 - C",
    "CADERNETA PREDIAL URBANA",
    "SERVIÇO DE FINANÇAS: 3085 - LISBOA-8",
    "IDENTIFICAÇÃO DO PRÉDIO",
    "DISTRITO: 11 - LISBOA CONCELHO: 06 - LISBOA FREGUESIA: 64 - ARROIOS",
    "ARTIGO MATRICIAL: 1234 NIP:",
    "FRACÇÃO: C",
    "LOCALIZAÇÃO DO PRÉDIO",
    "Av./Rua/Praça: RUA DE ANGOLA Nº: 25 Lugar:",
    "Código Postal: 1170-020 LISBOA",
    "DESCRIÇÃO DO PRÉDIO",
    "Tipo de Prédio: Prédio em Propriedade Horizontal",
    "Afectação: Habitação Nº de pisos da fracção: 1 Tipologia/Divisões: T2",
    "Página 1 de 2",
  ],
  [
    "110664 - ARROIOS - U - 1234 - C",
    "CADERNETA PREDIAL URBANA",
    "SERVIÇO DE FINANÇAS: 3085 - LISBOA-8",
    "TITULARES",
    "Identificação fiscal: 123456789 Nome: JOSÉ EXEMPLO",
    "Morada: RUA Z Tipo de titular: Propriedade plena Parte: 1/1",
    "Página 2 de 2",
  ],
]);

describe("POST /api/financas-import", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads a caderneta into a property to confirm", async () => {
    const res = await send("caderneta", CADERNETA);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.document).toMatchObject({ article: "1234", parishCode: "110664" });
    expect(data.document.holders).toEqual([
      { taxId: "123456789", name: "JOSÉ EXEMPLO", share: "1/1" },
    ]);
    expect(data.drafts).toEqual([
      expect.objectContaining({
        name: "Rua de Angola 25, C",
        zipCode: "1170-020",
        city: "Lisboa",
        type: "apartment",
        bedrooms: 2,
        cadasterReference: "1234",
        fraction: "C",
      }),
    ]);
  });

  it("reads a contract proof", async () => {
    const res = await send(
      "contract",
      pdfOf([
        [
          "COMUNICAÇÃO DE CONTRATOS DE ARRENDAMENTO",
          "Número de Contrato: 1234567",
          "Data de início do contrato: 2023-02-01",
          "Termo do contrato: 2026-01-31",
          "IDENTIFICAÇÃO DO IMÓVEL Freguesia: ARROIOS",
          "Artigo: 1234 Fração/Secção: C",
          "IDENTIFICAÇÃO DO LOCADOR",
          "NIF: 123456789 Nome: JOSÉ EXEMPLO Quota /Parte (fração): 1/1",
          "IDENTIFICAÇÃO DO LOCATÁRIO",
          "NIF: 287654321 País: PORTUGAL Nome: MARIA INQUILINA",
          "VALOR DA RENDA Valor da Renda: 850,00 € Período da Renda: Mensal",
        ],
      ]),
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.contract).toMatchObject({
      contractNumber: "1234567",
      startDate: "2023-02-01",
      endDate: "2026-01-31",
      monthlyRent: 850,
      article: "1234",
      fraction: "C",
    });
    expect(data.contract.tenants[0]).toMatchObject({ taxId: "287654321", name: "MARIA INQUILINA" });
  });

  it("refuses what is not a PDF, an unknown kind, and a PDF with no text", async () => {
    expect((await send("caderneta", new TextEncoder().encode("hello"))).status).toBe(415);
    expect((await send("other", CADERNETA)).status).toBe(400);
    expect((await send("contract", pdfOf([[""]]))).status).toBe(422);
  });

  it("checks the owner before reading anything", async () => {
    vi.mocked(requireOwnerAccess).mockResolvedValueOnce(
      new Response(null, { status: 401 }) as never,
    );
    expect((await send("caderneta", CADERNETA)).status).toBe(401);
  });
});
