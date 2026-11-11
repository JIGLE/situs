import { describe, expect, it } from "vitest";
import { parseContract } from "./contract";

// In the order of the Modelo 2 declaration the proof reproduces; names and NIFs are made up.
const PROOF = `COMUNICAÇÃO DE CONTRATOS DE ARRENDAMENTO COMPROVATIVO Número de Contrato: 1234567 Versão: 1 Motivo da Comunicação: Início de contrato I IDENTIFICAÇÃO DO CONTRATO Tipo: Arrendamento Finalidade: Habitacional (Permanente) Data de início do contrato: 2023-02-01 Termo do contrato: 2026-01-31 Contrato Renovável: Sim II IDENTIFICAÇÃO DO IMÓVEL Distrito: LISBOA Concelho: LISBOA Freguesia: ARROIOS Tipo: Urbano Artigo: 1234 Fração/Secção: C Parte Arrendada (Descritivo): Localização/Morada: RUA DE ANGOLA 25 2 ESQ 1170-020 LISBOA III IDENTIFICAÇÃO DO LOCADOR, SUBLOCADOR OU PROMITENTE LOCADOR (SENHORIO) NIF: 123456789 Nome: JOSÉ EXEMPLO Quota /Parte (fração): 1/2 NIF: 223456789 Nome: ANA EXEMPLO Quota /Parte (fração): 1/2 IV IDENTIFICAÇÃO DO LOCATÁRIO, SUBLOCATÁRIO OU PROMITENTE LOCATÁRIO (INQUILINO) NIF: 287654321 País: PORTUGAL Nome: MARIA INQUILINA NIF: 298765432 País: PORTUGAL Nome: PEDRO INQUILINO V VALOR DA RENDA Valor da Renda: 850,00 € Valor das despesas: 0,00 € Valor da Renda Máxima: 850,00 € Período da Renda: Mensal`;

describe("parseContract", () => {
  it("reads the contract, the property, the rent and both sides", () => {
    const parsed = parseContract(PROOF);
    expect(parsed).toMatchObject({
      recognised: true,
      contractNumber: "1234567",
      startDate: "2023-02-01",
      endDate: "2026-01-31",
      renewable: true,
      purpose: "Habitacional (Permanente)",
      monthlyRent: 850,
      rentNotMonthly: false,
      article: "1234",
      fraction: "C",
      parish: "ARROIOS",
    });
    expect(parsed.landlords).toEqual([
      { taxId: "123456789", name: "JOSÉ EXEMPLO", country: null, share: "1/2" },
      { taxId: "223456789", name: "ANA EXEMPLO", country: null, share: "1/2" },
    ]);
    expect(parsed.tenants.map((t) => [t.taxId, t.name, t.country])).toEqual([
      ["287654321", "MARIA INQUILINA", "PORTUGAL"],
      ["298765432", "PEDRO INQUILINO", "PORTUGAL"],
    ]);
  });

  it("reads plainer wording and day-first dates", () => {
    const parsed = parseContract(
      "Contrato de arrendamento n.º 7654321 Senhorio Nome: RUI A NIF: 111111111 Inquilino Nome: ZÉ B NIF: 222222222 Data de início: 01/03/2024 Data de fim: 28/02/2025 Valor da renda: 1.250,50 Imóvel Artigo matricial: 98 Fração: AB",
    );
    expect(parsed).toMatchObject({
      contractNumber: "7654321",
      startDate: "2024-03-01",
      endDate: "2025-02-28",
      monthlyRent: 1250.5,
      article: "98",
      fraction: "AB",
    });
    expect(parsed.landlords.map((p) => p.taxId)).toEqual(["111111111"]);
    expect(parsed.tenants.map((p) => p.name)).toEqual(["ZÉ B"]);
  });

  it("leaves blank what it cannot find, and flags a rent under a month", () => {
    const parsed = parseContract(
      "Arrendamento Fração/Secção: Parte Arrendada (Descritivo): Período da Renda: Inferior a 1 mês",
    );
    expect(parsed).toMatchObject({
      contractNumber: null,
      startDate: null,
      monthlyRent: null,
      fraction: null,
      rentNotMonthly: true,
      tenants: [],
    });
    expect(parseContract("Fatura de eletricidade").recognised).toBe(false);
  });
});
