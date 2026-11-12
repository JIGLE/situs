/**
 * What an invoice says about the cost it records: who issued it, on which day, for how much.
 * Pure, so the phone (reading a photo's QR code) and the server (reading a PDF's text) give the
 * expense form the same fields, which the owner then checks before anything is saved.
 *
 * Every Portuguese invoice since 2022 carries AT's QR code (Portaria 195/2020): fields joined by
 * `*`, each `key:value`. A issuer's NIF, B buyer's NIF, D document type, F date (YYYYMMDD),
 * G document number, H ATCUD, N total tax, O total with tax. Amounts use a dot.
 */

export interface InvoiceFields {
  /** The issuer's NIF: the supplier the expense was paid to. */
  supplierNif?: string;
  /** The NIF the invoice was made out to: the owner's, or a co-owner's. */
  buyerNif?: string;
  /** YYYY-MM-DD. */
  date?: string;
  /** With tax, which is what was paid. */
  total?: number;
  vat?: number;
  /** "FT A/123": what the owner looks for on the paper. */
  documentNumber?: string;
  atcud?: string;
  /** Where the fields came from, for the form to say so. */
  source: "qr" | "text";
}

const NIF = /^\d{9}$/;

/** The fields of an AT QR code, or null when the text is not one. */
export function parseAtQr(raw: string): InvoiceFields | null {
  const fields = new Map<string, string>();
  for (const part of raw.trim().split("*")) {
    const colon = part.indexOf(":");
    if (colon > 0) fields.set(part.slice(0, colon), part.slice(colon + 1));
  }
  const supplierNif = fields.get("A");
  const total = Number(fields.get("O"));
  // A, F and O are what make it an invoice's code rather than any QR code.
  if (!supplierNif || !NIF.test(supplierNif) || !fields.get("F") || !Number.isFinite(total)) {
    return null;
  }
  const f = fields.get("F") ?? "";
  const date = /^\d{8}$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : undefined;
  const vat = Number(fields.get("N"));
  const buyerNif = fields.get("B");
  return {
    supplierNif,
    buyerNif: buyerNif && NIF.test(buyerNif) ? buyerNif : undefined,
    date,
    total,
    vat: Number.isFinite(vat) ? vat : undefined,
    documentNumber: fields.get("G") || undefined,
    atcud: fields.get("H") && fields.get("H") !== "0" ? fields.get("H") : undefined,
    source: "qr",
  };
}

/** "1.234,56", "1234,56" or "1234.56" as a number. */
function amountOf(raw: string): number {
  const text = raw.replace(/\s/g, "");
  if (text.includes(",")) return Number(text.replace(/\./g, "").replace(",", "."));
  return Number(text);
}

// No nested quantifiers (security/detect-unsafe-regex): each pattern is a flat sequence.
const TOTAL_LINE = /total[^\d\n]{0,40}(\d[\d. ]*[.,]\d{2})/gi;
const TAX_WORDS = /iva|imposto|taxa|incid|desconto|ilíquido|iliquido|base/i;
const DATE_DMY = /\b(\d{2})[-/.](\d{2})[-/.](\d{4})\b/;
const DATE_YMD = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const NIF_LABELLED = /(?:NIF|NIPC|Contribuinte|N\.º Contrib|VAT)[^\d\n]{0,20}(?:PT)?(\d{9})\b/gi;
const ATCUD = /ATCUD[:\s]{0,3}([A-Z0-9]{8,}-\d+)/i;

/**
 * What a PDF invoice's text says, as far as it can be read without a layout: the largest
 * "Total" that is not a tax line, the first date, and the NIFs by their labels (the issuer's is
 * printed first, in the header). Anything not found is left out for the owner to type.
 */
export function readInvoiceText(pages: readonly string[]): InvoiceFields {
  const text = pages.join("\n");

  let total: number | undefined;
  for (const match of text.matchAll(TOTAL_LINE)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 1), (match.index ?? 0) + 40);
    if (TAX_WORDS.test(match[0]) || TAX_WORDS.test(before.split("\n")[0] ?? "")) continue;
    const value = amountOf(match[1]);
    if (Number.isFinite(value) && (total === undefined || value > total)) total = value;
  }

  const dmy = DATE_DMY.exec(text);
  const ymd = DATE_YMD.exec(text);
  const date = ymd
    ? `${ymd[1]}-${ymd[2]}-${ymd[3]}`
    : dmy
      ? `${dmy[3]}-${dmy[2]}-${dmy[1]}`
      : undefined;

  const nifs = [...text.matchAll(NIF_LABELLED)].map((m) => m[1]);
  const distinct = [...new Set(nifs)];

  return {
    supplierNif: distinct[0],
    buyerNif: distinct[1],
    date,
    total,
    atcud: ATCUD.exec(text)?.[1],
    source: "text",
  };
}

/** What an earlier expense paid to the same supplier says about a new one. */
export interface RememberedSupplier {
  vendorName?: string;
  category: string;
  propertyId: string;
  isDeductible?: boolean;
}

/**
 * The newest expense paid to this NIF, so a second invoice from the condomínio or the water
 * company arrives with the category, property and name the owner chose the first time.
 */
export function rememberedSupplier(
  expenses: readonly {
    vendorVat?: string | null;
    vendorName?: string | null;
    category: string;
    propertyId: string;
    isDeductible?: boolean;
    date: string;
  }[],
  nif: string | undefined,
): RememberedSupplier | null {
  if (!nif) return null;
  const last = expenses
    .filter((expense) => expense.vendorVat?.replace(/\D/g, "") === nif)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last) return null;
  return {
    vendorName: last.vendorName ?? undefined,
    category: last.category,
    propertyId: last.propertyId,
    isDeductible: last.isDeductible,
  };
}
