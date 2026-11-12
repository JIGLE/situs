/**
 * Helpers shared by the readers of Finanças documents (`caderneta.ts`, `contract.ts`).
 *
 * The PDF's text arrives as one stream: `unpdf` joins the items of a page with spaces, so a
 * "Label: value" pair sits next to the next label on the same line, and a line break is just a
 * space. A value is therefore read from its label up to the next label we know, never up to a
 * line end. Pure: no I/O.
 */

/** Collapses every run of whitespace (line breaks, non-breaking spaces) to one space. */
export function normalize(text: string): string {
  return text
    .replace(/[  -​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text after the first match of `label`, up to (not including) the first match of any of
 * `stops` after it, trimmed; null when the label is absent or the value is empty.
 */
export function valueAfter(text: string, label: RegExp, stops: RegExp[]): string | null {
  const found = label.exec(text);
  if (!found) return null;
  const rest = text.slice(found.index + found[0].length);
  let end = rest.length;
  for (const stop of stops) {
    const hit = stop.exec(rest);
    if (hit && hit.index < end) end = hit.index;
  }
  const value = rest
    .slice(0, end)
    .trim()
    .replace(/^[:\s]+/, "");
  return value === "" ? null : value;
}

/** A Portuguese amount ("1.234,56", "€ 98.765,43", "750,00 €") as a number, or null. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /(\d[\d.]*)(?:,(\d{1,4})|)/.exec(raw);
  if (!match) return null;
  // Dots group thousands; the comma is the decimal point.
  const whole = match[1].replace(/\./g, "");
  const value = Number(`${whole}.${match[2] ?? "0"}`);
  return Number.isFinite(value) ? value : null;
}

const DATE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/;

/** The first date in `raw` (YYYY-MM-DD, YYYY/MM/DD or DD-MM-YYYY) as `YYYY-MM-DD`, or null. */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = DATE.exec(raw);
  if (!m) return null;
  const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The regex source of a date, for labels that must be followed by one. */
export const DATE_SOURCE = DATE.source;

const LOWER_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em"]);

/**
 * "RUA DE ANGOLA" → "Rua de Angola". Finanças writes addresses and names in capitals; the rest
 * of the app shows them as people write them. A word with a digit or an ordinal ("2º", "R/C")
 * is left as it is.
 */
export function titleCase(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLocaleLowerCase("pt-PT")
    .split(" ")
    .map((word, i, words) => {
      if (!word) return word;
      if (/\d/.test(word) || word.includes("/")) return word.toLocaleUpperCase("pt-PT");
      // "Rua de Angola", but "Rua A": a lone last word is a name, not an article.
      if (i > 0 && i < words.length - 1 && LOWER_WORDS.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("pt-PT") + word.slice(1);
    })
    .join(" ");
}

/**
 * Street types and titles as Portuguese addresses abbreviate them. Words end at a space, not `\b`,
 * which does not see the end of "Praça" or "Capitão".
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/^Avenida(?= |$)/, "Av."],
  [/^Rua(?= |$)/, "R."],
  [/^Travessa(?= |$)/, "Tv."],
  [/^Praça(?= |$)/, "Pç."],
  [/^Praceta(?= |$)/, "Pct."],
  [/^Largo(?= |$)/, "Lg."],
  [/^Estrada(?= |$)/, "Estr."],
  [/^Calçada(?= |$)/, "Cç."],
  [/^Alameda(?= |$)/, "Al."],
  [/^Urbanização(?= |$)/, "Urb."],
  [/^Bairro(?= |$)/, "B."],
  [/^Quinta(?= |$)/, "Qta."],
  [/^Rotunda(?= |$)/, "Rot."],
  [/(?<=^| )Doutora(?= |$)/g, "Dra."],
  [/(?<=^| )Doutor(?= |$)/g, "Dr."],
  [/(?<=^| )Professora(?= |$)/g, "Prof.ª"],
  [/(?<=^| )Professor(?= |$)/g, "Prof."],
  [/(?<=^| )Engenheiro(?= |$)/g, "Eng."],
  [/(?<=^| )General(?= |$)/g, "Gen."],
  [/(?<=^| )Almirante(?= |$)/g, "Alm."],
  [/(?<=^| )Comandante(?= |$)/g, "Cmdt."],
  [/(?<=^| )Coronel(?= |$)/g, "Cor."],
  [/(?<=^| )Capitão(?= |$)/g, "Cap."],
  [/(?<=^| )Nossa Senhora(?= |$)/g, "N.ª Sr.ª"],
  [/(?<=^| )Santa(?= |$)/g, "Sta."],
  [/(?<=^| )Santo(?= |$)/g, "Sto."],
];

/**
 * "Rua Capitão Leitão" → "R. Cap. Leitão": a street as an owner writes it on a label, for a
 * property's short name. The full form stays in the address.
 */
export function shortStreet(street: string | null | undefined): string {
  let out = (street ?? "").trim();
  for (const [pattern, short] of ABBREVIATIONS) out = out.replace(pattern, short);
  // The street type takes no article after it: "R. de Angola" reads "R. Angola".
  return out.replace(/^([A-Z][a-zç]{0,4}\.) (?:de|da|do|das|dos) /, "$1 ");
}

/**
 * A fração or andar as Finanças and an owner may each write it ("2º ES", "2.º Es", "c"), reduced
 * to one comparable form: upper case, no spaces, dots or ordinal marks.
 */
export function fractionKey(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLocaleUpperCase("pt-PT")
    .replace(/[\s.ºª°]/g, "")
    .trim();
}

/** An article number as compared: digits (and a provisional "P"), no leading zeros or spaces. */
export function articleKey(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").toUpperCase().replace(/[^0-9P]/g, "");
  return cleaned.replace(/^(P?)0+(?=\d)/, "$1");
}
