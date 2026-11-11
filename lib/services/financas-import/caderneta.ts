/**
 * Reads a caderneta predial urbana, the record of a property Finanças issues as a PDF from
 * Património Predial, into what a Situs property needs. Pure: it takes the PDF's text.
 *
 * Three layouts are covered (Portaria 894/2004, models A and B):
 * - A building with independent units that is NOT in propriedade horizontal (model A): one
 *   caderneta, one article, and a block per unit headed "ANDAR OU DIVISÃO COM UTILIZAÇÃO
 *   INDEPENDENTE: <code>". Each unit becomes a property, its code standing as the fraction.
 * - A fração autónoma of a building in propriedade horizontal: one caderneta per fraction, the
 *   letter given under a "FRACÇÃO" label (spelt with or without the C).
 * - A whole property with no divisions, or a plot (model B): one property, no fraction.
 *
 * The owner confirms every field before anything is created, so a value this cannot find is left
 * blank rather than guessed.
 */
import { articleKey, normalize, parseAmount, titleCase, valueAfter } from "./text";

export interface CadernetaHolder {
  /** The titular's NIF, as printed. */
  taxId: string;
  name: string;
  /** Their part, as printed ("1/1", "1/2"). */
  share: string | null;
}

export interface CadernetaUnit {
  /** The fraction or the andar/divisão code ("C", "2º ES", "RC 1"); null for a whole property. */
  fraction: string | null;
  /** "Afectação": Habitação, Comércio, Serviços… */
  use: string | null;
  /** "Tipologia/Divisões": "T2", or a number of rooms. */
  layout: string | null;
  /** Bedrooms, only when the layout says so ("T2" is 2); a bare number of rooms says nothing. */
  bedrooms: number | null;
  /** Área bruta privativa, m². */
  area: number | null;
  /** Valor patrimonial actual (CIMI), €. */
  taxValue: number | null;
  /** The unit's own street line when it has one, else the building's. */
  street: string | null;
  doorNumber: string | null;
}

export interface ParsedCaderneta {
  /** Only an urban caderneta is read; a rústica is reported so the screen can say so. */
  kind: "urbana" | "rustica" | "unknown";
  district: string | null;
  municipality: string | null;
  parish: string | null;
  /** The parish's code, distrito + concelho + freguesia, six digits (what AT names it by). */
  parishCode: string | null;
  /** Artigo matricial. */
  article: string | null;
  street: string | null;
  doorNumber: string | null;
  place: string | null;
  postalCode: string | null;
  locality: string | null;
  /** "Tipo de Prédio", as printed. */
  propertyType: string | null;
  holders: CadernetaHolder[];
  units: CadernetaUnit[];
}

/** Section headings, which end any value before them. */
const SECTIONS = [
  /IDENTIFICA[ÇC][ÃA]O DO PR[ÉE]DIO/,
  /LOCALIZA[ÇC][ÃA]O DO/,
  /DESCRI[ÇC][ÃA]O DO PR[ÉE]DIO/,
  /CONFRONTA[ÇC][ÕO]ES/,
  /[ÁA]REAS \(em/i,
  /DADOS DE AVALIA[ÇC][ÃA]O/,
  /ELEMENTOS D[OA]/,
  /TEVE ORIGEM/,
  /ISEN[ÇC][ÕO]ES/,
  /TITULARES/,
  /(?:^|\s)ANDAR OU DIVIS[ÃA]O/,
  /Emitido (?:via|no|em)/,
  /ELEMENTOS PARA A VALIDA/,
];

/** Labels of the address line. */
const ADDRESS_LABELS = [
  /Av\.\/Rua\/Pra[çc]a ?:/i,
  /N[ºo°] ?(?:de pol[íi]cia)? ?:/i,
  /Lugar ?:/i,
  /C[óo]digo Postal ?:/i,
  /Andar\/Divis[ãa]o ?:/i,
];

const UNIT_HEADING = /(?:^|\s)ANDAR OU DIVIS[ÃA]O COM UTILIZA[ÇC][ÃA]O INDEPENDENTE ?: ?/g;

/** The repeated page header and the page footers, taken out so a value never runs into them. */
function stripPageFurniture(pages: string[]): string {
  const cleaned = pages.map((page) => normalize(page).replace(/P[áa]gina \d+ de \d+/gi, " "));
  const first = cleaned[0] ?? "";
  const headerEnd = first.search(/IDENTIFICA[ÇC][ÃA]O DO PR[ÉE]DIO/);
  const header = headerEnd > 20 ? first.slice(0, headerEnd).trim() : "";
  const rest = cleaned.slice(1).map((page) => (header ? page.split(header).join(" ") : page));
  return normalize([first, ...rest].join(" "));
}

/** Takes out every "TEVE ORIGEM NOS ARTIGOS" block: its Artigo and Fracção are the old ones. */
function withoutOrigins(text: string): string {
  let out = text;
  for (;;) {
    const start = out.search(/TEVE ORIGEM NOS ARTIGOS/);
    if (start < 0) return out;
    const after = out.slice(start + 10);
    let end = after.length;
    for (const stop of SECTIONS.filter((s) => !s.source.startsWith("TEVE"))) {
      const hit = stop.exec(after);
      if (hit && hit.index < end) end = hit.index;
    }
    out = `${out.slice(0, start)} ${after.slice(end)}`;
  }
}

function addressOf(text: string): { street: string | null; doorNumber: string | null } {
  const street = valueAfter(text, ADDRESS_LABELS[0], [...ADDRESS_LABELS.slice(1), ...SECTIONS]);
  const doorNumber = valueAfter(text, /(?:^|\s)N[ºo°] ?(?:de pol[íi]cia)? ?:/i, [
    ...ADDRESS_LABELS.slice(2),
    ...SECTIONS,
  ]);
  return { street, doorNumber };
}

function bedroomsOf(layout: string | null): number | null {
  const match = /^T ?(\d{1,2})\b/i.exec(layout ?? "");
  return match ? Number(match[1]) : null;
}

function unitFrom(block: string, fraction: string | null): CadernetaUnit {
  const unitStops = [/Tipologia/i, /N[ºo°] de pisos/i, /Permilagem/i, /[ÁA]rea/i, ...SECTIONS];
  const use = valueAfter(block, /Afe[c]?ta[çc][ãa]o ?:/i, unitStops);
  const layoutRaw = valueAfter(block, /Tipologia\/Divis[õo]es ?:/i, [
    /Permilagem/i,
    /N[ºo°] de pisos/i,
    /\s[A-ZÁ-Ú][a-zá-ú]+\s/,
    ...SECTIONS,
  ]);
  const layout = layoutRaw ? layoutRaw.split(" ")[0] : null;
  const area = parseAmount(valueAfter(block, /[ÁA]rea bruta privativa ?:/i, [/m[²2]/]));
  const taxValue = parseAmount(
    valueAfter(block, /Valor patrimonial actual \(CIMI\) ?:/i, [/Determinado/i, ...SECTIONS]),
  );
  const { street, doorNumber } = addressOf(block);
  return {
    fraction,
    use,
    layout,
    bedrooms: bedroomsOf(layout),
    area,
    taxValue,
    street,
    doorNumber,
  };
}

/** The fraction of a propriedade horizontal caderneta, when it names one. */
function horizontalFraction(text: string): string | null {
  // "FRACÇÃO: C", "FRAÇÃO AUTÓNOMA: AB", "Fracção: 1"; never "fracções" (an area label).
  const labelled =
    /FRA[CÇ]{1,2}[ÃA]O(?: AUT[ÓO]NOMA)? ?: ?([A-Z]{1,3}\d{0,2}|\d{1,3}[A-Z]?)\b/i.exec(text);
  if (labelled) return labelled[1].toUpperCase();
  return null;
}

function holdersOf(text: string): CadernetaHolder[] {
  const start = text.search(/TITULARES/);
  if (start < 0) return [];
  const section = text.slice(start);
  const holders: CadernetaHolder[] = [];
  const pattern =
    /Identifica[çc][ãa]o fiscal ?: ?(\d{9}) ?Nome ?: ?(.+?)(?= Morada ?:| Tipo de titular| Identifica[çc][ãa]o fiscal|$)/gi;
  for (const match of section.matchAll(pattern)) {
    const after = section.slice((match.index ?? 0) + match[0].length);
    const nextHolder = after.search(/Identifica[çc][ãa]o fiscal/i);
    const own = nextHolder >= 0 ? after.slice(0, nextHolder) : after;
    const share = /Parte ?: ?(\d+ ?\/ ?\d+)/i.exec(own);
    holders.push({
      taxId: match[1],
      name: match[2].trim(),
      share: share ? share[1].replace(/\s/g, "") : null,
    });
  }
  return holders;
}

/**
 * Reads a caderneta from its pages' text. Pages are passed separately so the header every page
 * repeats can be taken out; a single string is one page.
 */
export function parseCaderneta(pages: string[] | string): ParsedCaderneta {
  const raw = stripPageFurniture(Array.isArray(pages) ? pages : [pages]);
  const text = withoutOrigins(raw);

  const kind = /CADERNETA PREDIAL URBANA/i.test(text)
    ? "urbana"
    : /CADERNETA PREDIAL R[ÚU]STICA/i.test(text)
      ? "rustica"
      : "unknown";

  const districtMatch = /DISTRITO ?: ?(\d{2}) ?- ?(.+?) CONCELHO/i.exec(text);
  const municipalityMatch = /CONCELHO ?: ?(\d{2}) ?- ?(.+?) FREGUESIA/i.exec(text);
  const parishMatch = /FREGUESIA ?: ?(\d{2}) ?- ?(.+?) ARTIGO MATRICIAL/i.exec(text);
  const articleMatch = /ARTIGO MATRICIAL ?: ?(P? ?\d+)/i.exec(text);

  // The building's location: the first LOCALIZAÇÃO block, before any unit.
  const firstUnit = text.search(UNIT_HEADING);
  const head = firstUnit >= 0 ? text.slice(0, firstUnit) : text;
  const { street, doorNumber } = addressOf(head);
  const place = valueAfter(head, /Lugar ?:/i, [/C[óo]digo Postal/i, ...SECTIONS]);
  const postal = /C[óo]digo Postal ?: ?(\d{4}) ?- ?(\d{3})/i.exec(head);
  // The town follows the postcode, up to the next heading or label.
  const locality = postal
    ? valueAfter(head.slice(postal.index), /C[óo]digo Postal ?: ?\d{4} ?- ?\d{3}/i, [
        ...SECTIONS,
        /\s[^\s:]+ ?:/,
      ])
    : null;

  const propertyType = valueAfter(text, /Tipo de Pr[ée]dio ?:/i, [
    /Descri[çc][ãa]o ?:/i,
    /N[ºo°] de pisos/i,
    ...SECTIONS,
  ]);

  const units: CadernetaUnit[] = [];
  const headings = [...text.matchAll(UNIT_HEADING)];
  if (headings.length > 0) {
    headings.forEach((heading, i) => {
      const from = (heading.index ?? 0) + heading[0].length;
      const to = i + 1 < headings.length ? (headings[i + 1].index ?? text.length) : text.length;
      const block = text.slice(from, to);
      // The code is short ("LJ B", "2º ES", "C/V D"): it ends at the next heading or label.
      const code = valueAfter(` ${block}`, /^/, [
        /LOCALIZA[ÇC][ÃA]O/,
        /ELEMENTOS/,
        /Av\.\/Rua/i,
        / [^ :]+ ?:/,
        ...SECTIONS,
      ]);
      const andar = valueAfter(block, /Andar\/Divis[ãa]o ?:/i, [
        /ELEMENTOS/,
        /Afe[c]?ta/i,
        ...SECTIONS,
      ]);
      units.push(unitFrom(block, (code ?? andar)?.trim() || null));
    });
  } else {
    units.push(unitFrom(text, horizontalFraction(text)));
  }

  return {
    kind,
    district: districtMatch ? districtMatch[2].trim() : null,
    municipality: municipalityMatch ? municipalityMatch[2].trim() : null,
    parish: parishMatch ? parishMatch[2].trim() : null,
    parishCode:
      districtMatch && municipalityMatch && parishMatch
        ? `${districtMatch[1]}${municipalityMatch[1]}${parishMatch[1]}`
        : null,
    article: articleMatch ? articleKey(articleMatch[1]) : null,
    street,
    doorNumber,
    place,
    postalCode: postal ? `${postal[1]}-${postal[2]}` : null,
    locality: locality || null,
    propertyType,
    holders: holdersOf(text),
    units,
  };
}

/** What the import screen shows and the owner edits: one property, as the create form takes it. */
export interface PropertyDraft {
  name: string;
  address: string;
  streetAddress: string;
  city: string;
  zipCode: string;
  type: "apartment" | "house" | "commercial" | "other";
  bedrooms: number | null;
  cadasterReference: string;
  fraction: string;
  /** What the screen says beside it: the use and area, for recognising the unit. */
  use: string | null;
  area: number | null;
}

function typeOf(
  use: string | null,
  propertyType: string | null,
  divided: boolean,
): PropertyDraft["type"] {
  const u = (use ?? "").toLowerCase();
  const p = (propertyType ?? "").toLowerCase();
  if (p.includes("terreno")) return "other";
  if (u.includes("habita")) return divided ? "apartment" : "house";
  if (/com[ée]rcio|servi[çc]o|ind[úu]stri|armaz/.test(u)) return "commercial";
  if (!u) return divided ? "apartment" : "house";
  return "other";
}

/** One draft per unit the caderneta describes. */
export function cadernetaDrafts(parsed: ParsedCaderneta): PropertyDraft[] {
  const divided = parsed.units.length > 1 || parsed.units.some((u) => !!u.fraction);
  const city = titleCase(parsed.locality || parsed.municipality);
  return parsed.units.map((unit) => {
    const streetRaw = unit.street ?? parsed.street ?? parsed.place;
    const door = unit.doorNumber ?? parsed.doorNumber;
    const streetAddress = [titleCase(streetRaw), door].filter(Boolean).join(" ");
    const fraction = unit.fraction ?? "";
    const name =
      [streetAddress || titleCase(parsed.parish), fraction].filter(Boolean).join(", ") ||
      `Artigo ${parsed.article ?? ""}`.trim();
    const address = [
      [streetAddress, fraction].filter(Boolean).join(", "),
      [parsed.postalCode, city].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    return {
      name: name.slice(0, 100),
      address: (address || name).slice(0, 200),
      streetAddress: streetAddress.slice(0, 200),
      city: city.slice(0, 100),
      zipCode: parsed.postalCode ?? "",
      type: typeOf(unit.use, parsed.propertyType, divided),
      bedrooms: unit.bedrooms,
      cadasterReference: parsed.article ?? "",
      fraction: fraction.slice(0, 20),
      use: unit.use,
      area: unit.area,
    };
  });
}
