import type { ContractExtraction } from "@/lib/services/contracts/schema";

/**
 * What Claude might read out of a two-landlord contract with a co-tenant and a guarantor, and
 * AT's proof of registration. Shared by the unit tests and by the E2E stub of the extract call.
 * Every NIF here passes its check digit.
 */
export const sampleExtraction: ContractExtraction = {
  landlords: [
    {
      name: "Maria Fernandes",
      taxId: "123456789",
      taxCountry: "PT",
      email: null,
      share: 50,
      source: { quote: "MARIA FERNANDES, contribuinte n.º 123 456 789", page: 1 },
    },
    {
      name: "Paulo Fernandes",
      taxId: "234567899",
      taxCountry: "PT",
      email: null,
      share: 50,
      source: { quote: "PAULO FERNANDES, contribuinte n.º 234 567 899", page: 1 },
    },
  ],
  tenants: [
    {
      name: "Ana Costa",
      taxId: "246813571",
      taxCountry: "PT",
      idDocument: null,
      email: "ana.costa@example.pt",
      phone: "+351 912 345 678",
      source: { quote: "ANA COSTA, NIF 246 813 571, ana.costa@example.pt", page: 1 },
    },
    {
      name: "Rui Costa",
      taxId: "450000001",
      taxCountry: "PT",
      idDocument: null,
      email: null,
      phone: null,
      source: { quote: "RUI COSTA, NIF 450 000 001", page: 1 },
    },
  ],
  guarantors: [
    {
      name: "Hans Weber",
      taxId: "DE 123 456",
      taxCountry: "DE",
      idDocument: "C01X00T47",
      source: { quote: "HANS WEBER, passaporte C01X00T47", page: 2 },
    },
  ],
  property: {
    address: "Rua Augusta 12, 3.º Esq.",
    postalCode: "1100-048",
    city: "Lisboa",
    matrixArticle: "2321",
    fraction: "C",
    typology: "T2",
    source: { quote: "fração C, artigo matricial 2321, Rua Augusta 12, 3.º Esq.", page: 1 },
  },
  terms: {
    startDate: {
      value: "2026-01-01",
      source: { quote: "com início em 1 de janeiro de 2026", page: 2 },
    },
    endDate: { value: "2026-12-31", source: { quote: "termo em 31 de dezembro de 2026", page: 2 } },
    monthlyRent: { value: 950, source: { quote: "renda mensal de 950,00 €", page: 2 } },
    deposit: { value: 1900, source: { quote: "caução de 1.900,00 €", page: 3 } },
    autoRenew: { value: true, source: { quote: "renova-se automaticamente", page: 2 } },
    renewalNoticeDays: {
      value: 120,
      source: { quote: "com a antecedência mínima de 120 dias", page: 2 },
    },
  },
  registration: {
    contractNumber: "20240012345",
    version: 1,
    source: { quote: "N.º do contrato: 20240012345", page: 1 },
  },
  clauses: [
    {
      kind: "rent_update",
      summary: "A renda é atualizada todos os anos pelo coeficiente legal.",
      quote: "A renda será atualizada anualmente de acordo com o coeficiente publicado.",
      page: 3,
    },
    {
      kind: "renewal",
      summary: "Renova-se por períodos de um ano, salvo oposição com 120 dias.",
      quote: "O contrato renova-se automaticamente por períodos sucessivos de um ano.",
      page: 2,
    },
  ],
};
