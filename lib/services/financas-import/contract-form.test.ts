import { describe, expect, it } from "vitest";
import { isContractForm, parseContractForm } from "./contract-form";
import type { PdfItem } from "./pdf-text";

// The Modelo 2 form as the Portal draws it: labels in their fonts, then every filled value in a
// font of its own, at the positions the real form uses. Names, NIFs and numbers are made up.
const L = "label";
const H = "heading";
const V = "value";
const at = (x: number, y: number, str: string, font = L): PdfItem => ({
  str,
  x,
  y,
  width: str.length * 4,
  font,
});

const LABELS: PdfItem[] = [
  at(167, 710, "(Modelo 2)", H),
  at(14, 422, "ANTES DE PREENCHER LEIA ATENTAMENTE TODO O IMPRESSO", H),
  at(229, 687, "IDENTIFICAÇÃO DO CONTRATO", H),
  at(40, 672, "Tipo"),
  at(26, 654, "1 - Arrendamento"),
  at(26, 638, "2 - Subarrendamento"),
  at(153, 672, "Finalidade"),
  at(136, 654, "1 - Habitacional (Permanente)"),
  at(136, 636, "2 - Habitacional (Não Permanente)"),
  at(136, 619, "3 - Não Habitacional"),
  at(269, 672, "Data do facto comunicado"),
  at(255, 656, "1 - Início do contrato / Disponibilização"),
  at(255, 611, "3 - Início das alterações"),
  at(467, 672, "Termo do contrato"),
  at(471, 626, "Contrato Renovável"),
  at(466, 607, "Sim"),
  at(466, 592, "Não"),
  at(237, 572, "IDENTIFICAÇÃO DO IMÓVEL", H),
  at(87, 553, "Distrito:"),
  at(87, 534, "Artigo:"),
  at(87, 516, "Parte Arrendada (Descritivo):"),
  at(212, 553, "Concelho:"),
  at(212, 534, "Fração/Secção:"),
  at(384, 553, "Freguesia:"),
  at(384, 534, "Árvore/Colónia:"),
  at(40, 498, "Localização/Morada:"),
  at(72, 529, "13", H),
  at(131, 473, "IDENTIFICAÇÃO DO LOCADOR, SUBLOCADOR OU PROMITENTE LOCADOR (", H),
  at(44, 448, "NIF"),
  at(134, 448, "Nome"),
  at(363, 448, "Regime de bens de casamento"),
  at(475, 448, "NIF cônjuge"),
  at(351, 427, "Comunhão de adquiridos"),
  at(42, 412, "Quota /Parte (fração)"),
  at(122, 372, "IDENTIFICAÇÃO DO LOCATÁRIO, SUBLOCATÁRIO OU PROMITENTE LOCATÁRIO (", H),
  at(44, 347, "NIF"),
  at(137, 347, "País"),
  at(329, 347, "Nome"),
  at(255, 306, "VALOR DA RENDA", H),
  at(41, 289, "Valor da Renda"),
  at(173, 289, "Valor das Despesas"),
  at(298, 289, "Valor da Renda Máxima"),
  at(427, 289, "Periodo da Renda"),
  at(427, 274, "Mensal"),
  at(427, 265, "Inferior a 1 mês"),
  at(221, 250, "TERCEIRO AUTORIZADO A CUMPRIR AS OBRIGAÇÕES DECORRENTES DO", H),
  at(304, 107, "N.º da Declaração:"),
  at(431, 107, "N.º de Contrato:"),
];

const VALUES: PdfItem[] = [
  at(125, 654, "X", V),
  at(241, 654, "X", V),
  at(391, 610, "2025-06-01", V),
  at(478, 648, "2020-03-31", V),
  at(512, 607, "X", V),
  at(87, 541, "11 - LISBOA", V),
  at(87, 524, "4321", V),
  at(212, 541, "06 - LISBOA", V),
  at(212, 524, "C", V),
  at(419, 551, "08 - UNIÃO DAS FREGUESIAS DE", V),
  at(385, 541, "SANTO EXEMPLO E OUTRO", V),
  at(40, 487, "RUA DO EXEMPLO 10 1 ESQ 1000-001 LISBOA", V),
  at(65, 428, "123456789", V),
  at(134, 434, "ANA EXEMPLO", V),
  at(435, 426, "X", V),
  at(475, 427, "198765432", V),
  at(97, 386, "1/1", V),
  at(56, 323, "287654321", V),
  at(118, 323, "PORTUGAL", V),
  at(310, 332, "MARIA INQUILINA EXEMPLO", V),
  at(131, 265, "725,50 €", V),
  at(200, 265, "40,00 €", V),
  at(511, 274, "X", V),
  at(344, 96, "11112222", V),
  at(469, 96, "765432 - 1", V),
];

const form = (values: PdfItem[] = VALUES) => [[...LABELS, ...values]];

describe("parseContractForm", () => {
  it("reads each value from its own box, not from the text order", () => {
    expect(parseContractForm(form())).toEqual({
      recognised: true,
      contractNumber: "765432",
      // The only date is of a change to the contract, not of its start.
      startDate: null,
      endDate: "2020-03-31",
      renewable: true,
      purpose: "Habitacional (Permanente)",
      monthlyRent: 725.5,
      rentNotMonthly: false,
      article: "4321",
      fraction: "C",
      parish: "UNIÃO DAS FREGUESIAS DE SANTO EXEMPLO E OUTRO",
      // The spouse's NIF is not a second landlord.
      landlords: [{ taxId: "123456789", name: "ANA EXEMPLO", country: null, share: "1/1" }],
      tenants: [
        { taxId: "287654321", name: "MARIA INQUILINA EXEMPLO", country: "PORTUGAL", share: null },
      ],
    });
  });

  it("takes the date on the start's line as the start, and a tick on Não and under a month", () => {
    // The renewable and period ticks move to the other option; the changes' date goes.
    const moved = (v: PdfItem) => v.str === "2025-06-01" || (v.str === "X" && v.x > 500);
    const values = VALUES.filter((v) => !moved(v)).concat([
      at(391, 654, "2019-04-01", V),
      at(512, 592, "X", V),
      at(511, 265, "X", V),
    ]);
    expect(parseContractForm(form(values))).toMatchObject({
      startDate: "2019-04-01",
      renewable: false,
      rentNotMonthly: true,
    });
  });

  it("leaves blank what the form left blank", () => {
    const parsed = parseContractForm(form([]));
    expect(parsed).toMatchObject({
      recognised: true,
      article: null,
      fraction: null,
      monthlyRent: null,
      renewable: null,
      purpose: null,
      landlords: [],
      tenants: [],
    });
  });

  it("is not the reader for a comprovativo", () => {
    const proof = [[at(40, 700, "COMPROVATIVO"), at(40, 680, "Artigo: 1234")]];
    expect(isContractForm(proof[0])).toBe(false);
    expect(parseContractForm(proof)).toBeNull();
  });
});
