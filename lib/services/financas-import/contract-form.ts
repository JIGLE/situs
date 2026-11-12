/**
 * Reads the Modelo 2 declaration itself, the filled form the Portal gives back for a registered
 * lease ("Comunicação de contratos de arrendamento (Modelo 2)"), as opposed to its comprovativo.
 * Pure.
 *
 * The form is a printed page with boxes, and the PDF draws its labels first and every filled
 * value after them, in a font of its own: read in text order, no value follows its label. So it is
 * read by position. Each value is the value-font text inside its label's box (below the label, or
 * on its line), a ticked option is an "X" beside the option on its line, and the landlords and
 * tenants are told apart by the quadro their row sits in. Only the first page is read: the
 * continuation sheets have layouts of their own.
 */
import type { ContractPerson, ParsedContract } from "./contract";
import type { PdfItem } from "./pdf-text";
import { articleKey, normalize, parseAmount, parseDate } from "./text";

const text = (item: PdfItem) => normalize(item.str);

/** Marks only the form carries: the comprovativo restates the quadros as "Label: value" lines. */
const FORM_MARKS = [/^\(Modelo 2\)$/i, /^ANTES DE PREENCHER LEIA/i];

/** Labels and headings the form always prints: their fonts are the label fonts. */
const KNOWN_LABELS = [
  /^Artigo:$/i,
  /^Distrito:$/i,
  /^Freguesia:$/i,
  /^NIF$/,
  /^Nome$/,
  /^Valor da Renda$/i,
  /^IDENTIFICA[ÇC][ÃA]O DO IM[ÓO]VEL$/i,
  /^Termo do contrato$/i,
];

const NIF = /^\d{9}$/;
const SHARE = /^\d+ ?\/ ?\d+$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** "1 - Habitacional (Permanente)" → "Habitacional (Permanente)". */
const OPTION_NUMBER = /^\d+ - /;

/** Points a value's baseline may sit above its label's, or a tick from its option's. */
const SAME_LINE = 6;

export function isContractForm(page: PdfItem[]): boolean {
  return FORM_MARKS.some((mark) => page.some((item) => mark.test(text(item))));
}

export function parseContractForm(pages: PdfItem[][]): ParsedContract | null {
  const page = pages.find(isContractForm);
  if (!page) return null;

  const labelFonts = new Set(
    page.filter((i) => KNOWN_LABELS.some((l) => l.test(text(i)))).map((i) => i.font),
  );
  if (labelFonts.size === 0) return null;
  const labels = page.filter((i) => labelFonts.has(i.font));
  const values = page.filter((i) => !labelFonts.has(i.font));

  const label = (re: RegExp, within?: Band | null) =>
    labels.find((i) => re.test(text(i)) && (!within || inBand(i, within))) ?? null;

  /** The values in a label's box: from its line down to `depth` points below, `span` wide. */
  const boxed = (at: PdfItem | null, span: number, depth = 20) =>
    at
      ? values
          .filter(
            (v) => v.x >= at.x - 15 && v.x < at.x + span && v.y <= at.y + 3 && v.y >= at.y - depth,
          )
          .sort((a, b) => b.y - a.y || a.x - b.x)
      : [];

  /** The option a tick sits beside: the nearest label to its left on its line. */
  const ticked = (within: Band): string[] =>
    values
      .filter((v) => text(v) === "X" && inBand(v, within))
      .map((x) => besideOnLeft(labels, x))
      .filter((l): l is PdfItem => l !== null)
      .map(text);

  // The quadros, top to bottom: each runs from its heading down to the next.
  const heading = (re: RegExp) => labels.find((i) => re.test(text(i)))?.y ?? null;
  const contractTop = heading(/^IDENTIFICA[ÇC][ÃA]O DO CONTRATO$/i);
  const propertyTop = heading(/^IDENTIFICA[ÇC][ÃA]O DO IM[ÓO]VEL$/i);
  const landlordTop = heading(/^IDENTIFICA[ÇC][ÃA]O DO LOCADOR,/i);
  const tenantTop = heading(/^IDENTIFICA[ÇC][ÃA]O DO LOCAT[ÁA]RIO/i);
  const rentTop = heading(/^VALOR DA RENDA$/i);
  const rentBottom = heading(/^TERCEIRO AUTORIZADO/i) ?? (rentTop !== null ? rentTop - 60 : null);
  const band = (top: number | null, bottom: number | null): Band | null =>
    top !== null && bottom !== null ? { top, bottom } : null;
  const contractBand = band(contractTop, propertyTop);
  const propertyBand = band(propertyTop, landlordTop);
  const landlordBand = band(landlordTop, tenantTop);
  const tenantBand = band(tenantTop, rentTop);
  const rentBand = band(rentTop, rentBottom);

  // I: the contract.
  const options = contractBand ? ticked(contractBand) : [];
  const purposeOption = options.find((o) => /Habitacional|Rural/i.test(o));
  const renewableOption = options.find((o) => /^(?:Sim|N[ãa]o)$/i.test(o));
  const termLabel = label(/^Termo do contrato$/i);
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (contractBand) {
    for (const v of values) {
      if (!DATE_ONLY.test(text(v)) || !inBand(v, contractBand)) continue;
      if (termLabel && v.x >= termLabel.x - 15) {
        endDate = parseDate(text(v));
        continue;
      }
      // The date of the fact sits on the line of the fact it dates; only the start is a start.
      const fact = besideOnLeft(labels, v);
      if (fact && /^(?:1 - In[íi]cio do contrato|2 - Celebra[çc][ãa]o)/i.test(text(fact))) {
        startDate = parseDate(text(v));
      }
    }
  }

  // II: the property.
  const article = boxed(label(/^Artigo:$/i, propertyBand), 110).map(text)[0] ?? null;
  const fraction =
    boxed(label(/^Fra[çc][ãa]o\/Sec[çc][ãa]o:$/i, propertyBand), 110).map(text)[0] ?? null;
  const parishParts = boxed(label(/^Freguesia:$/i, propertyBand), 200).map(text);
  const parish =
    parishParts.length > 0 ? parishParts.join(" ").replace(OPTION_NUMBER, "").trim() : null;

  // III and IV: the people, a row each.
  const landlords = landlordBand ? landlordRows(values, labels, landlordBand) : [];
  const tenants = tenantBand ? tenantRows(values, labels, tenantBand) : [];

  // V: the rent.
  let monthlyRent: number | null = null;
  let rentNotMonthly = false;
  if (rentBand) {
    const rentLabel = label(/^Valor da Renda$/i, rentBand);
    const expenses = label(/^Valor das Despesas$/i, rentBand);
    const span = rentLabel && expenses ? expenses.x - rentLabel.x : 120;
    monthlyRent = parseAmount(boxed(rentLabel, span, 30).map(text)[0] ?? null);
    rentNotMonthly = ticked(rentBand).some((o) => /^Inferior/i.test(o));
  }

  // XI: the number AT gave the contract ("564984 - 6": the number, then its check digit).
  const numberLabel = label(/^N\.?º de Contrato:?$/i);
  const numberValue = numberLabel
    ? values.find(
        (v) => v.x >= numberLabel.x - 10 && v.y <= numberLabel.y + 3 && v.y >= numberLabel.y - 15,
      )
    : undefined;
  const contractNumber = numberValue ? (/^(\d+)/.exec(text(numberValue))?.[1] ?? null) : null;

  return {
    recognised: true,
    contractNumber,
    startDate,
    endDate,
    renewable: renewableOption ? /^sim$/i.test(renewableOption) : null,
    purpose: purposeOption ? purposeOption.replace(OPTION_NUMBER, "") : null,
    monthlyRent,
    rentNotMonthly,
    article: article ? articleKey(article) : null,
    fraction,
    parish: parish || null,
    landlords,
    tenants,
  };
}

interface Band {
  /** The quadro's heading line. */
  top: number;
  /** The next quadro's heading line. */
  bottom: number;
}

const inBand = (item: PdfItem, band: Band) => item.y < band.top && item.y > band.bottom;

function besideOnLeft(labels: PdfItem[], value: PdfItem): PdfItem | null {
  let best: PdfItem | null = null;
  for (const l of labels) {
    if (l.x >= value.x || Math.abs(l.y - value.y) > SAME_LINE) continue;
    if (!best || l.x > best.x) best = l;
  }
  return best;
}

/** Pairs each NIF with the name nearest its line, and the n-th quota with the n-th landlord. */
function pair(
  nifs: PdfItem[],
  names: PdfItem[],
  extra: (nif: PdfItem, index: number) => Partial<ContractPerson>,
): ContractPerson[] {
  const people: ContractPerson[] = [];
  nifs
    .sort((a, b) => b.y - a.y)
    .forEach((nif, index) => {
      const name = names
        .filter((n) => Math.abs(n.y - nif.y) <= 15)
        .sort((a, b) => Math.abs(a.y - nif.y) - Math.abs(b.y - nif.y))[0];
      if (!name) return;
      people.push({
        taxId: text(nif),
        name: text(name),
        country: null,
        share: null,
        ...extra(nif, index),
      });
    });
  return people;
}

function landlordRows(values: PdfItem[], labels: PdfItem[], band: Band): ContractPerson[] {
  const own = values.filter((v) => inBand(v, band));
  const nameLabel = labels.find((l) => text(l) === "Nome" && inBand(l, band));
  const regime = labels.find((l) => /^Regime de bens/i.test(text(l)) && inBand(l, band));
  if (!nameLabel) return [];
  const nameEnd = regime ? regime.x - 5 : nameLabel.x + 220;
  // The spouse's NIF sits in the last column, past the marriage regime: not a landlord.
  const nifs = own.filter((v) => NIF.test(text(v)) && v.x < nameLabel.x);
  const names = own.filter(
    (v) => !/\d/.test(text(v)) && text(v) !== "X" && v.x >= nameLabel.x - 20 && v.x < nameEnd,
  );
  const shares = own.filter((v) => SHARE.test(text(v))).sort((a, b) => b.y - a.y);
  return pair(nifs, names, (_nif, index) => ({
    share: shares[index] ? text(shares[index]).replace(/\s/g, "") : null,
  }));
}

function tenantRows(values: PdfItem[], labels: PdfItem[], band: Band): ContractPerson[] {
  const own = values.filter((v) => inBand(v, band));
  const nameLabel = labels.find((l) => text(l) === "Nome" && inBand(l, band));
  const countryLabel = labels.find((l) => /^Pa[íi]s$/i.test(text(l)) && inBand(l, band));
  if (!nameLabel) return [];
  // The name's box starts left of its label; the country's ends halfway between the two.
  const split = countryLabel ? (countryLabel.x + nameLabel.x) / 2 : nameLabel.x - 30;
  const nifs = own.filter((v) => NIF.test(text(v)));
  const names = own.filter((v) => !/\d/.test(text(v)) && v.x >= split);
  const countries = own.filter((v) => !/\d/.test(text(v)) && v.x < split);
  return pair(nifs, names, (nif) => {
    const country = countries.find((c) => Math.abs(c.y - nif.y) <= 15);
    return { country: country ? text(country).toUpperCase() : null };
  });
}
