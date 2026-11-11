/**
 * Reads the proof of a lease registered with Finanças (the comprovativo of the Modelo 2
 * declaration, downloaded from Arrendamento › Contratos) into what a Situs tenancy needs. Pure.
 *
 * The comprovativo follows the declaration's quadros: the contract (tipo, finalidade, the start,
 * the term, renewable), the property (freguesia, artigo, fração/secção), the landlords (NIF, nome,
 * quota), the tenants (NIF, país, nome), the rent (valor, período), and the number AT gave the
 * contract. Labels are read loosely, since only the declaration form's wording is public; anything
 * not found is left blank for the owner, who confirms the tenancy before it is saved.
 */
import { DATE_SOURCE, articleKey, normalize, parseAmount, parseDate, valueAfter } from "./text";

export interface ContractPerson {
  taxId: string;
  name: string;
  /** A tenant's country, when printed ("PT", "PORTUGAL"). */
  country: string | null;
  /** A landlord's quota ("1/2"). */
  share: string | null;
}

export interface ParsedContract {
  /** Whether this looks like a lease document at all. */
  recognised: boolean;
  /** The number AT gave the contract, which every receipt names. */
  contractNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  renewable: boolean | null;
  /** Habitacional (permanente / não permanente), não habitacional, rural; as printed. */
  purpose: string | null;
  monthlyRent: number | null;
  /** True when the rent is for a period under a month, which a monthly lease cannot hold. */
  rentNotMonthly: boolean;
  article: string | null;
  fraction: string | null;
  parish: string | null;
  landlords: ContractPerson[];
  tenants: ContractPerson[];
}

const PERSON_STOPS = [
  /\s(?:NIF|N\.?I\.?F\.?)\b/i,
  /\sRegime/i,
  /\sNIF c[ôo]njuge/i,
  /\sQuota/i,
  /\sParte\b/i,
  /\sPa[íi]s\b/i,
  /\sIsen[çc]/i,
  /\sNome\b/i,
  /\sMorada/i,
  /\sIDENTIFICA[ÇC][ÃA]O/i,
  /\sVALOR DA RENDA/i,
  /\sQUADRO/i,
  /\sLOCAT[ÁA]RIO/i,
  /\sLOCADOR/i,
  /\sTERCEIRO/i,
  /\sOBSERVA[ÇC]/i,
  /\sDocumento/i,
  /\s\d{9}\b/,
  // A quadro's roman numeral before its heading ("V VALOR DA RENDA"): upper case only.
  /\s[IVX]{1,4} [A-ZÁÉÍÓÚÇÃÕ]{4,}/,
];

/** Where each role's people begin: the quadro headings, and the plainer words a proof may use. */
const LANDLORD_MARK = /\b(?:SUB)?LOCADOR(?:ES|\(ES\))?\b|\bSENHORIO(?:S|\(S\))?\b/gi;
const TENANT_MARK =
  /\b(?:SUB)?LOCAT[ÁA]RIO(?:S|\(S\))?\b|\bINQUILINO(?:S|\(S\))?\b|\bARRENDAT[ÁA]RIO/gi;
/** Where the people end: the rent, the observations, the third party. */
const AFTER_PEOPLE =
  /VALOR DA RENDA|TERCEIRO AUTORIZADO|OBSERVA[ÇC][ÕO]ES|NIF do locador em caso/gi;

type Mark = { at: number; role: "landlord" | "tenant" | "none" };

function marks(text: string): Mark[] {
  const found: Mark[] = [];
  for (const m of text.matchAll(LANDLORD_MARK)) found.push({ at: m.index ?? 0, role: "landlord" });
  for (const m of text.matchAll(TENANT_MARK)) found.push({ at: m.index ?? 0, role: "tenant" });
  for (const m of text.matchAll(AFTER_PEOPLE)) found.push({ at: m.index ?? 0, role: "none" });
  return found.sort((a, b) => a.at - b.at);
}

function roleAt(all: Mark[], at: number): Mark["role"] {
  let role: Mark["role"] = "none";
  for (const mark of all) {
    if (mark.at > at) break;
    role = mark.role;
  }
  return role;
}

/** Every NIF with a name beside it, in either order, with where it sits. */
function people(text: string): { at: number; person: ContractPerson }[] {
  const out: { at: number; person: ContractPerson }[] = [];
  const nifFirst =
    /(?:NIF|N\.?I\.?F\.?|Identifica[çc][ãa]o fiscal) ?:? ?(\d{9})\b(?: ?Pa[íi]s ?:? ?([A-Za-zÀ-ú]{2,20})|) ?Nome ?:? ?/gi;
  for (const m of text.matchAll(nifFirst)) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const name = valueAfter(` ${rest}`, /^/, PERSON_STOPS);
    if (!name) continue;
    out.push({ at: m.index ?? 0, person: withExtras(text, m.index ?? 0, m[1], name, m[2]) });
  }
  if (out.length > 0) return out;
  // "Nome: X NIF: 123456789"
  const nameFirst = /Nome ?:? ?(.+?) (?:NIF|N\.?I\.?F\.?) ?:? ?(\d{9})\b/gi;
  for (const m of text.matchAll(nameFirst)) {
    out.push({ at: m.index ?? 0, person: withExtras(text, m.index ?? 0, m[2], m[1], null) });
  }
  return out;
}

function withExtras(
  text: string,
  at: number,
  taxId: string,
  name: string,
  country: string | null | undefined,
): ContractPerson {
  // The quota and country sit after the name, before the next person.
  const after = text.slice(at + 10);
  const nextPerson = after.search(/(?:NIF|Identifica[çc][ãa]o fiscal) ?:? ?\d{9}/i);
  const own = nextPerson >= 0 ? after.slice(0, nextPerson) : after.slice(0, 300);
  const share = /(?:Quota|Parte) ?(?:\/ ?Parte|) ?(?:\(fra[çc][ãa]o\))? ?:? ?(\d+ ?\/ ?\d+)/i.exec(
    own,
  );
  const countryAfter = /Pa[íi]s ?:? ?([A-Za-zÀ-ú]{2,20})/i.exec(own);
  return {
    taxId,
    name: name.trim(),
    country: (country ?? countryAfter?.[1] ?? null)?.toUpperCase() ?? null,
    share: share ? share[1].replace(/\s/g, "") : null,
  };
}

function dateAfter(text: string, label: RegExp): string | null {
  // Built from this file's own literal labels, never from the document.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const re = new RegExp(`${label.source}[^0-9]{0,80}?(${DATE_SOURCE})`, "i");
  const m = re.exec(text);
  return m ? parseDate(m[1]) : null;
}

export function parseContract(pages: string[] | string): ParsedContract {
  const text = normalize(Array.isArray(pages) ? pages.join(" ") : pages);

  const recognised = /arrendamento|locat[áa]rio|locador|renda/i.test(text);

  const numberMatch =
    /(?:N[úu]mero|N\.? ?[ºo°]) ?(?:de|do) ?contrato ?:? ?(\d{4,})/i.exec(text) ??
    /(?:Identifica[çc][ãa]o|ID) ?do ?contrato ?:? ?(\d{4,})/i.exec(text) ??
    /Contrato(?: de arrendamento)? ?(?:n\.? ?[ºo°]|n[úu]mero) ?:? ?(\d{4,})/i.exec(text);

  const startDate =
    dateAfter(text, /(?:Data ?(?:de|do) ?|)in[íi]cio(?: ?do ?contrato|)/) ??
    dateAfter(text, /Disponibiliza[çc][ãa]o do bem locado/);
  const endDate = dateAfter(
    text,
    /(?:Termo(?: ?do ?contrato|)|Data ?(?:de|do) ?(?:fim|termo)|Fim do contrato)/,
  );

  const renewableMatch = /Renov[áa]vel ?:? ?(Sim|N[ãa]o)/i.exec(text);

  const purpose = valueAfter(text, /Finalidade ?:?/i, [
    /\s(?:Data|Termo|Contrato|Renov|Tipo|In[íi]cio|IDENTIFICA|Prazo)/i,
  ]);

  const rentRaw = valueAfter(text, /Valor da renda(?! ?m[áa]xima) ?(?:mensal)? ?:?/i, [
    /\s(?:Valor das despesas|Valor da renda m|Per[íi]odo|Periodicidade)/i,
  ]);
  const monthlyRent = parseAmount(rentRaw);
  const rentNotMonthly = /(?:Per[íi]odo da renda|Periodicidade) ?:? ?Inferior/i.test(text);

  // The property block: from its heading (or the first "Artigo") on.
  const propertyAt = text.search(
    /IDENTIFICA[ÇC][ÃA]O DO(?:S)? IM[ÓO]V|IM[ÓO]VE(?:L|IS)\b|Artigo ?(?:matricial)? ?:/i,
  );
  const propertyText = propertyAt >= 0 ? text.slice(propertyAt) : text;
  const articleMatch = /Artigo ?(?:matricial)? ?:? ?(P? ?\d+)/i.exec(propertyText);
  const fractionMatch =
    /Fra[çc][ãa]o(?: ?\/ ?Sec[çc][ãa]o|)(?: ?aut[óo]noma|) ?:? ?([A-Z0-9][A-Z0-9º°ª./-]*(?: (?:ESQ|ES|DTO|DT|DR|FR|TRAS)\b|))/i.exec(
      propertyText,
    );
  const parish = valueAfter(propertyText, /Freguesia ?:?/i, [
    /\s(?:Artigo|Tipo|Fra[çc]|Concelho|Distrito|Sec[çc]|Parte|Localiza)/i,
  ]);

  const all = marks(text);
  const landlords: ContractPerson[] = [];
  const tenants: ContractPerson[] = [];
  const seen = new Set<string>();
  for (const { at, person } of people(text)) {
    const role = roleAt(all, at);
    const key = `${role}:${person.taxId}`;
    if (role === "none" || seen.has(key)) continue;
    seen.add(key);
    (role === "landlord" ? landlords : tenants).push(person);
  }

  const fraction = fractionMatch?.[1]?.trim() ?? null;
  return {
    recognised,
    contractNumber: numberMatch ? numberMatch[1] : null,
    startDate,
    endDate,
    renewable: renewableMatch ? /^sim$/i.test(renewableMatch[1]) : null,
    purpose,
    monthlyRent,
    rentNotMonthly,
    article: articleMatch ? articleKey(articleMatch[1]) : null,
    // A fraction field left empty prints its next label; that is not a fraction.
    fraction: fraction && !/^(?:PARTE|ÁRVORE|ARVORE|LOCALIZA)/i.test(fraction) ? fraction : null,
    parish,
    landlords,
    tenants,
  };
}
