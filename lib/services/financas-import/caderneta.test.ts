import { describe, expect, it } from "vitest";
import { cadernetaDrafts, parseCaderneta } from "./caderneta";

// Texts in the shape `unpdf` gives them: one stream per page, labels and values side by side.
// The layouts follow real cadernetas (labels, order, the repeated header); names and NIFs are
// made up.

const HEADER =
  "151203 - ALMADA - U - 374 CADERNETA PREDIAL URBANA SERVIÇO DE FINANÇAS: 2151 - ALMADA-1";

/** A building with independent units, not in propriedade horizontal (model A). */
const MODEL_A = [
  `${HEADER} IDENTIFICAÇÃO DO PRÉDIO DISTRITO: 15 - SETUBAL CONCELHO: 03 - ALMADA FREGUESIA: 12 - UNIÃO DAS FREGUESIAS DE ALMADA, COVA DA PIEDADE, PRAGAL E CACILHAS ARTIGO MATRICIAL: 374 NIP: TEVE ORIGEM NOS ARTIGOS DISTRITO: 15 - SETUBAL CONCELHO: 03 - ALMADA FREGUESIA: 01 - ALMADA Tipo: URBANO Artigo: 1253 LOCALIZAÇÃO DO PRÉDIO Av./Rua/Praça: RUA CAPITÃO LEITÃO Nº: 9 Lugar: Almada Código Postal: 2800-051 ALMADA DESCRIÇÃO DO PRÉDIO Tipo de Prédio: Prédio em Prop. Total com Andares ou Div. Susc. de Utiliz. Independente Descrição: PREDIO DE CAVE, RES-DO-CHAO E DOIS ANDARES Nº de pisos do artigo: 4 Nº de andares ou divisões com utliz. independente: 2 Valor patrimonial total: € 342.522,07 ÁREAS (em m²) Área total do terreno: 330,0000 m² Área de implantação do edifício: 250,0000 m² Área bruta privativa total: 700,0000 m² Área de terreno integrante das fracções: 0,0000 m² ANDAR OU DIVISÃO COM UTILIZAÇÃO INDEPENDENTE: LJ B Página 1 de 3`,
  `${HEADER} LOCALIZAÇÃO DO ANDAR OU DIVISÃO COM UTILIZAÇÃO INDEPENDENTE Av./Rua/Praça: RUA CAPITÃO LEITÃO Nº: 9 Andar/Divisão: LJ B ELEMENTOS DO ANDAR OU DIVISÃO COM UTILIZAÇÃO INDEPENDENTE Afectação: Comércio Tipologia/Divisões: 1 Permilagem: 120,0000 Nº de pisos da fracção: 1 ÁREAS (em m²) Área do terreno integrante: 0,0000 m² Área bruta privativa: 60,5000 m² Área bruta dependente: 0,0000 m² DADOS DE AVALIAÇÃO Ano de inscrição na matriz: 1960 Valor patrimonial actual (CIMI): € 25.280,00 Determinado no ano: 2024 Página 2 de 3`,
  `${HEADER} ANDAR OU DIVISÃO COM UTILIZAÇÃO INDEPENDENTE: 2º ES LOCALIZAÇÃO DO ANDAR OU DIVISÃO COM UTILIZAÇÃO INDEPENDENTE Av./Rua/Praça: RUA CAPITÃO LEITÃO Nº: 9 Andar/Divisão: 2º ES ELEMENTOS DO ANDAR OU DIVISÃO COM UTILIZAÇÃO INDEPENDENTE Afectação: Habitação Tipologia/Divisões: T3 Permilagem: 150,0000 Nº de pisos da fracção: 1 ÁREAS (em m²) Área bruta privativa: 98,2000 m² DADOS DE AVALIAÇÃO Valor patrimonial actual (CIMI): € 61.120,00 Determinado no ano: 2024 TEVE ORIGEM NOS ARTIGOS Artigo: 382 Fracção: D TITULARES Identificação fiscal: 500000000 Nome: EMPRESA EXEMPLO LDA Morada: RUA X, 1, LISBOA Tipo de titular: Propriedade plena Parte: 1/1 Documento: OUTRO Entidade: Emitido via internet em 2026-03-03 Página 3 de 3`,
];

/** A building plot (model B): no units, no fraction. */
const PLOT = `061614 - TABUA - U - 2419 CADERNETA PREDIAL URBANA SERVIÇO DE FINANÇAS: 0868 - TABUA IDENTIFICAÇÃO DO PRÉDIO DISTRITO: 06 - COIMBRA CONCELHO: 16 - TABUA FREGUESIA: 14 - TABUA ARTIGO MATRICIAL: 2419 NIP: LOCALIZAÇÃO DO PRÉDIO Av./Rua/Praça: QTA DO PINHEIRO Lugar: TABUA Código Postal: 3420-301 TÁBUA DESCRIÇÃO DO PRÉDIO Tipo de Prédio: Terreno para Construção Descrição: LOTE DE TERRENO ÁREAS (em m²) Área total do terreno: 600,0000 m² DADOS DE AVALIAÇÃO Valor patrimonial actual (CIMI): €9.794,75 Determinado no ano: 2021 TITULARES Identificação fiscal: 123456789 Nome: MARIA DA SILVA Morada: RUA Y Tipo de titular: Propriedade plena Parte: 1/2 Identificação fiscal: 234567890 Nome: JOÃO DA SILVA Morada: RUA Y Tipo de titular: Propriedade plena Parte: 1/2 Emitido via internet em 2023-07-19`;

/** A fração autónoma of a building in propriedade horizontal. */
const FRACTION = `110664 - ARROIOS - U - 1234 - C CADERNETA PREDIAL URBANA SERVIÇO DE FINANÇAS: 3085 - LISBOA-8 IDENTIFICAÇÃO DO PRÉDIO DISTRITO: 11 - LISBOA CONCELHO: 06 - LISBOA FREGUESIA: 64 - ARROIOS ARTIGO MATRICIAL: 1234 NIP: FRACÇÃO: C LOCALIZAÇÃO DO PRÉDIO Av./Rua/Praça: RUA DE ANGOLA Nº: 25 Lugar: Código Postal: 1170-020 LISBOA DESCRIÇÃO DO PRÉDIO Tipo de Prédio: Prédio em Propriedade Horizontal ELEMENTOS DA FRACÇÃO Andar/Divisão: 2º ESQ Afectação: Habitação Nº de pisos da fracção: 1 Tipologia/Divisões: T2 Permilagem: 125,0000 ÁREAS (em m²) Área bruta privativa: 85,0000 m² DADOS DE AVALIAÇÃO Valor patrimonial actual (CIMI): €98.765,43 Determinado no ano: 2024 TITULARES Identificação fiscal: 123456789 Nome: JOSÉ EXEMPLO Morada: RUA Z Tipo de titular: Propriedade plena Parte: 1/1`;

describe("parseCaderneta", () => {
  it("reads a building with independent units as one unit per andar", () => {
    const parsed = parseCaderneta(MODEL_A);
    expect(parsed).toMatchObject({
      kind: "urbana",
      district: "SETUBAL",
      municipality: "ALMADA",
      parishCode: "150312",
      article: "374",
      street: "RUA CAPITÃO LEITÃO",
      doorNumber: "9",
      postalCode: "2800-051",
      locality: "ALMADA",
    });
    expect(parsed.parish).toMatch(/^UNIÃO DAS FREGUESIAS DE ALMADA/);
    expect(parsed.units).toHaveLength(2);
    expect(parsed.units[0]).toMatchObject({
      fraction: "LJ B",
      use: "Comércio",
      layout: "1",
      bedrooms: null,
      area: 60.5,
      taxValue: 25280,
    });
    expect(parsed.units[1]).toMatchObject({
      fraction: "2º ES",
      use: "Habitação",
      layout: "T3",
      bedrooms: 3,
      area: 98.2,
      taxValue: 61120,
    });
    expect(parsed.holders).toEqual([
      { taxId: "500000000", name: "EMPRESA EXEMPLO LDA", share: "1/1" },
    ]);
  });

  it("does not take the origin article or fraction for the property's own", () => {
    const parsed = parseCaderneta(MODEL_A);
    expect(parsed.article).toBe("374");
    expect(parsed.units.map((u) => u.fraction)).not.toContain("D");
  });

  it("reads a plot as one property with no fraction, and every holder", () => {
    const parsed = parseCaderneta(PLOT);
    expect(parsed).toMatchObject({
      article: "2419",
      parishCode: "061614",
      street: "QTA DO PINHEIRO",
      doorNumber: null,
      postalCode: "3420-301",
      locality: "TÁBUA",
      propertyType: "Terreno para Construção",
    });
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0]).toMatchObject({ fraction: null, taxValue: 9794.75 });
    expect(parsed.holders.map((h) => [h.taxId, h.share])).toEqual([
      ["123456789", "1/2"],
      ["234567890", "1/2"],
    ]);
  });

  it("reads a fraction in propriedade horizontal", () => {
    const parsed = parseCaderneta(FRACTION);
    expect(parsed.article).toBe("1234");
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0]).toMatchObject({
      fraction: "C",
      use: "Habitação",
      bedrooms: 2,
      area: 85,
      taxValue: 98765.43,
    });
  });

  it("says when a document is not an urban caderneta", () => {
    expect(parseCaderneta("CADERNETA PREDIAL RÚSTICA ARTIGO MATRICIAL: 12").kind).toBe("rustica");
    expect(parseCaderneta("Uma fatura qualquer").kind).toBe("unknown");
  });
});

describe("cadernetaDrafts", () => {
  it("turns each unit into a property the owner can confirm", () => {
    const drafts = cadernetaDrafts(parseCaderneta(MODEL_A));
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      name: "Rua Capitão Leitão 9, LJ B",
      streetAddress: "Rua Capitão Leitão 9",
      city: "Almada",
      zipCode: "2800-051",
      type: "commercial",
      cadasterReference: "374",
      fraction: "LJ B",
    });
    expect(drafts[1]).toMatchObject({ type: "apartment", bedrooms: 3, fraction: "2º ES" });
    expect(drafts[1].address).toBe("Rua Capitão Leitão 9, 2º ES, 2800-051 Almada");
  });

  it("names a fraction by its street and letter, and a plot as other", () => {
    expect(cadernetaDrafts(parseCaderneta(FRACTION))[0]).toMatchObject({
      name: "Rua de Angola 25, C",
      type: "apartment",
      city: "Lisboa",
    });
    expect(cadernetaDrafts(parseCaderneta(PLOT))[0]).toMatchObject({
      name: "Qta do Pinheiro",
      type: "other",
      fraction: "",
    });
  });
});
