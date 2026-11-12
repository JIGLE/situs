/**
 * Reads a recibo de renda eletrónico, the PDF the Portal das Finanças issues for a rent payment,
 * into what the rent ledger needs: which month it pays, how much, when it was received, and who
 * the people on it are. Pure: no I/O.
 *
 * AT's model of the recibo (Modelo_Recibo_de_renda_eletronico.pdf) prints, in this order: the
 * title and "RECIBO DE RENDA N.º", "DATA DE EMISSÃO", the landlord and tenant blocks (NOME, NIF),
 * "IDENTIFICAÇÃO DO IMÓVEL" with a row "Freguesia Tipo Artigo Fração/Secção", the contract type,
 * "Período a que respeita a renda … a …", "Valor", "Retenção de IRS", "Importância Recebida", the
 * título (Renda, Caução, Adiantamento) and "Data de recebimento". A filled PDF may draw its values
 * apart from its labels, as the filled Modelo 2 form does (`contract-form.ts`), so every value is
 * read first beside its label and then, failing that, from its shape alone: the period is the one
 * pair of dates joined by "a", the NIFs are the nine-digit numbers that pass the check digit, and
 * the amounts are the three that add up (valor − retenção = importância). The owner confirms the
 * month and the contract before anything is written.
 */
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";
import { DATE_SOURCE, articleKey, normalize, parseAmount, parseDate, valueAfter } from "./text";

export interface ParsedRentReceipt {
  /** Whether this looks like a recibo de renda at all. */
  recognised: boolean;
  /** The recibo's number on the Portal. */
  number: string | null;
  issuedOn: string | null;
  receivedOn: string | null;
  /** The period the rent is for, as printed ("2026-01-01" to "2026-01-31"). */
  periodStart: string | null;
  periodEnd: string | null;
  /** The rent ("Valor"), before any IRS withheld. What the month owed. */
  rent: number | null;
  /** IRS the tenant withheld, when any. */
  withheld: number | null;
  /** What reached the landlord ("Importância Recebida"). */
  received: number | null;
  /** Every valid NIF on the recibo, landlords and tenants alike, in the order printed. */
  taxIds: string[];
  article: string | null;
  fraction: string | null;
}

// eslint-disable-next-line security/detect-non-literal-regexp -- a constant source
const DATE_GLOBAL = new RegExp(DATE_SOURCE, "g");
/** "1.234,56" or "750,00": an amount as Portuguese prints it, always with its cents. */
const AMOUNT_GLOBAL = /(?<![\d.])\d[\d.]{0,14},\d{2}(?!\d)/g;
/** The period: two dates joined by "a" (or "até"), optionally after "de". */
// eslint-disable-next-line security/detect-non-literal-regexp -- constant sources
const PERIOD = new RegExp(`(${DATE_SOURCE}) (?:a|até) (${DATE_SOURCE})`, "i");
/** The property row: freguesia code, tipo (U urbano, R rústico, O omisso), artigo, fração. */
const PROPERTY_ROW = /\b\d{6} ([URO]) (P?\d{1,6})\b(?: ([A-Z]{1,3})\b|)/;

const LABEL_STOPS = [
  /\sDATA DE/i,
  /\sEMITENTE/i,
  /\sLOCAT[ÁA]RIO/i,
  /\sLOCADOR/i,
  /\sNOME\b/i,
  /\sNIF\b/i,
  /\sIDENTIFICA[ÇC][ÃA]O/i,
  /\sPer[íi]odo/i,
  /\sValor\b/i,
  /\sReten[çc][ãa]o/i,
  /\sImport[âa]ncia/i,
  /\sIMPORTANCIA/i,
  /\sTIPO DE CONTRATO/i,
  /\sINFORMA[ÇC][ÕO]ES/i,
  /\sAssinatura/i,
  /\sDocumento emitido/i,
  /\sOriginal\b/i,
  /\sDuplicado\b/i,
];

function dateAfter(text: string, label: RegExp): string | null {
  const value = valueAfter(text, label, LABEL_STOPS);
  // The label's own value only: a date further on belongs to another field.
  return value && /^\d/.test(value) ? parseDate(value.slice(0, 10)) : null;
}

function amountAfter(text: string, label: RegExp): number | null {
  const value = valueAfter(text, label, LABEL_STOPS);
  if (!value) return null;
  const match = /^(?:€ ?|)(\d[\d.]{0,14},\d{2})/.exec(value);
  return match ? parseAmount(match[1]) : null;
}

const cents = (value: number) => Math.round(value * 100);

/**
 * The rent, the IRS withheld and what was received, from the amounts on the page when their
 * labels did not give them: the three that add up, else the one amount printed.
 */
function amountsByShape(
  amounts: number[],
): Pick<ParsedRentReceipt, "rent" | "withheld" | "received"> {
  const distinct = [...new Set(amounts.map(cents))].filter((c) => c > 0).sort((a, b) => b - a);
  for (const rent of distinct) {
    // The IRS withheld is the smaller part (a quarter at most), so it is tried smallest first.
    for (const withheld of [...distinct].reverse()) {
      if (withheld * 2 >= rent) continue;
      if (distinct.includes(rent - withheld)) {
        return { rent: rent / 100, withheld: withheld / 100, received: (rent - withheld) / 100 };
      }
    }
  }
  if (distinct.length === 1) {
    return { rent: distinct[0] / 100, withheld: null, received: distinct[0] / 100 };
  }
  return { rent: null, withheld: null, received: null };
}

export function parseRentReceipt(pages: string[]): ParsedRentReceipt {
  // The PDF prints the recibo twice (original and duplicado); the first copy is enough.
  const text = normalize(pages.join(" "));

  const recognised = /RECI[BD]O DE RENDA/i.test(text);
  const numberMatch = /RECI[BD]O DE RENDA (?:ELETR[ÓO]NICO |)N\.? ?[º°o] ?:? ?(\d{1,10})\b/i.exec(
    text,
  );

  // The period: the pair of dates beside its label, or the first pair joined by "a" anywhere.
  const periodLabel = /Per[íi]odo a que respeita(?: a renda|)/i.exec(text);
  const periodFrom = periodLabel ? text.slice(periodLabel.index) : text;
  const period = PERIOD.exec(periodFrom) ?? PERIOD.exec(text);
  // DATE_SOURCE holds six groups of its own, so the second date is group 8.
  let periodStart = period ? parseDate(period[1]) : null;
  let periodEnd = period ? parseDate(period[8]) : null;
  const dates = [...text.matchAll(DATE_GLOBAL)].flatMap((m) => parseDate(m[0]) ?? []);
  if (!periodStart) {
    // Drawn apart from "a": two dates in a row, the first before the second, a month to a year apart.
    for (let i = 0; i + 1 < dates.length; i++) {
      const days = (Date.parse(dates[i + 1]) - Date.parse(dates[i])) / 86_400_000;
      if (days >= 27 && days <= 366) {
        periodStart = dates[i];
        periodEnd = dates[i + 1];
        break;
      }
    }
  }

  const issuedOn = dateAfter(text, /DATA DE EMISS[ÃA]O/i);
  let receivedOn = dateAfter(text, /Data de recebimento/i);
  if (!receivedOn) {
    // Drawn apart from its label: the last date on the page that is neither the period nor the
    // date of issue, else the date of issue (a recibo is issued once the rent is received).
    const other = dates.filter((d) => d !== periodStart && d !== periodEnd && d !== issuedOn);
    receivedOn = other.at(-1) ?? issuedOn ?? null;
  }

  let rent = amountAfter(text, /\bValor\b/i);
  let withheld = amountAfter(text, /Reten[çc][ãa]o de IRS/i);
  let received = amountAfter(text, /Import[âa]ncia Recebida(?! A T[ÍI]TULO)/i);
  if (rent === null || received === null) {
    const shaped = amountsByShape(
      [...text.matchAll(AMOUNT_GLOBAL)].flatMap((m) => {
        const value = parseAmount(m[0]);
        return value === null ? [] : [value];
      }),
    );
    rent ??= shaped.rent;
    withheld ??= shaped.withheld;
    received ??= shaped.received;
  }
  if (rent === null && received !== null) rent = round2(received + (withheld ?? 0));

  const taxIds = [...new Set([...text.matchAll(/(?<!\d)\d{9}(?!\d)/g)].map((m) => m[0]))].filter(
    validatePortugueseNIF,
  );

  const propertyFrom = /IDENTIFICA[ÇC][ÃA]O DO IM[ÓO]VEL/i.exec(text);
  const row = PROPERTY_ROW.exec(propertyFrom ? text.slice(propertyFrom.index) : text);
  const articleLabel = /Artigo ?(?:matricial|) ?:? ?(P? ?\d{1,6})\b/i.exec(text);

  return {
    recognised,
    number: numberMatch?.[1] ?? null,
    issuedOn,
    receivedOn,
    periodStart,
    periodEnd,
    rent,
    withheld: withheld && withheld > 0 ? withheld : null,
    received,
    taxIds,
    article: row ? articleKey(row[2]) : articleLabel ? articleKey(articleLabel[1]) : null,
    fraction: row?.[3] ?? null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
