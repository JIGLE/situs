/**
 * Situs bank CSV parser — pure, no IO.
 *
 * Accepts the messy reality of European bank exports: `;` or `,` delimiters,
 * quoted fields, `1.234,56` or `1234.56` amounts, `dd/mm/yyyy`, `dd-mm-yyyy`
 * or ISO dates, and localized header names (PT/ES/EN/IT). Rows that cannot be
 * parsed are reported per-line instead of failing the whole import.
 */

export interface BankCsvRow {
  bookingDate: string; // ISO "YYYY-MM-DD"
  valueDate?: string;
  amount: number;
  counterpartyName?: string;
  counterpartyIban?: string;
  reference?: string;
}

export interface CsvParseResult {
  rows: BankCsvRow[];
  errors: string[];
}

/**
 * The imported row as it is safe to persist verbatim, with `counterpartyIban` removed.
 *
 * `BankTransaction.rawData` keeps the original row so an import can be re-read or re-matched
 * later. Serialising the row as-is defeated the encryption one field above it: the IBAN was
 * written AES-256-GCM encrypted into `counterpartyIban`, and then again in clear inside
 * `rawData`, which is an ordinary unencrypted column. Anything that could read the row could
 * read the IBAN, and `/api/debug/db` would have returned it.
 *
 * The IBAN is the only field this drops. `counterpartyName` and `reference` stay, because they
 * are already stored in plaintext columns of their own — omitting them here would hide nothing
 * and lose the fidelity `rawData` exists for. The encrypted `counterpartyIban` column and the
 * `counterpartyIbanHash` carry everything the pipeline actually reads.
 */
export function redactRowForStorage(row: BankCsvRow): Omit<BankCsvRow, "counterpartyIban"> {
  // Destructured out rather than deleted from a copy, so a future field added to BankCsvRow
  // is carried through by `rest` and this keeps compiling.
  const { counterpartyIban: _omitted, ...rest } = row;
  return rest;
}

const HEADER_ALIASES: Record<keyof BankCsvRow, string[]> = {
  bookingDate: ["bookingdate", "booking date", "date", "data", "fecha", "data mov", "data valor"],
  valueDate: ["valuedate", "value date", "data valor", "fecha valor", "settlement date"],
  amount: ["amount", "montante", "importe", "importo", "valor", "value"],
  counterpartyName: [
    "counterparty",
    "counterparty name",
    "name",
    "sender",
    "ordenante",
    "remetente",
    "beneficiario",
    "descricao",
    "descrição",
  ],
  counterpartyIban: ["iban", "counterparty iban", "iban ordenante", "account", "conta"],
  reference: ["reference", "referencia", "referência", "concepto", "descritivo", "description"],
};

function detectDelimiter(headerLine: string): string {
  return headerLine.includes(";") ? ";" : ",";
}

/** Quote-aware single-line field splitter. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** "1.234,56" → 1234.56 · "1,234.56" → 1234.56 · "1234.56" → 1234.56 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[€$\s]/g, "");
  if (!cleaned) return null;
  let normalized: string;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is the decimal separator (European)
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** ISO, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy → "YYYY-MM-DD" */
export function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const eu = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (eu) {
    const day = Number(eu[1]);
    const month = Number(eu[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${eu[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function matchHeader(header: string): keyof BankCsvRow | null {
  const normalized = header.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  // valueDate aliases overlap bookingDate ("data valor") — check valueDate first
  // only when the header explicitly mentions value/valor as a qualifier word.
  const order: (keyof BankCsvRow)[] = [
    "valueDate",
    "bookingDate",
    "amount",
    "counterpartyIban",
    "counterpartyName",
    "reference",
  ];
  for (const field of order) {
    if (
      HEADER_ALIASES[field].some(
        (alias) => alias.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === normalized,
      )
    ) {
      return field;
    }
  }
  return null;
}

export function parseBankCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV needs a header row and at least one data row"] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter);
  const columnMap = new Map<number, keyof BankCsvRow>();
  for (let i = 0; i < headers.length; i++) {
    const field = matchHeader(headers[i]);
    if (field && ![...columnMap.values()].includes(field)) columnMap.set(i, field);
  }

  if (![...columnMap.values()].includes("bookingDate")) {
    return { rows: [], errors: ["No date column recognized in the CSV header"] };
  }
  if (![...columnMap.values()].includes("amount")) {
    return { rows: [], errors: ["No amount column recognized in the CSV header"] };
  }

  const rows: BankCsvRow[] = [];
  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const fields = splitCsvLine(lines[lineNo], delimiter);
    const raw: Partial<Record<keyof BankCsvRow, string>> = {};
    for (const [index, field] of columnMap) {
      if (fields[index] !== undefined && fields[index] !== "") raw[field] = fields[index];
    }

    const bookingDate = raw.bookingDate ? parseDate(raw.bookingDate) : null;
    const amount = raw.amount !== undefined ? parseAmount(raw.amount) : null;
    if (!bookingDate) {
      errors.push(`Line ${lineNo + 1}: unrecognized date "${raw.bookingDate ?? ""}"`);
      continue;
    }
    if (amount === null || amount === 0) {
      errors.push(`Line ${lineNo + 1}: unrecognized amount "${raw.amount ?? ""}"`);
      continue;
    }

    rows.push({
      bookingDate,
      valueDate: raw.valueDate ? (parseDate(raw.valueDate) ?? undefined) : undefined,
      amount,
      counterpartyName: raw.counterpartyName,
      counterpartyIban: raw.counterpartyIban?.replace(/\s+/g, "").toUpperCase(),
      reference: raw.reference,
    });
  }

  return { rows, errors };
}
