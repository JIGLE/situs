import { round2 } from "@/lib/utils/money";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";
import type { EmitirReciboFields, EmitirReciboTenant } from "./soap";

/**
 * One AT receipt for one rent month: the fields `emitirRecibo` takes (manual §4.1), built from what
 * Situs holds, or what stops them being built. Pure: the service reads the records, this decides.
 *
 * A blocker names something the owner can fix in Situs: a contract without AT's number, a person
 * without a NIF. AT's own refusals are not predicted here; they come back from AT as its field
 * errors, in Portuguese.
 *
 * What is not sent yet, and why a receipt that needs it is refused rather than issued without it:
 * - `retencaoFonte`: withholding. A tenant whose NIF is an entity's must usually withhold 25%, and
 *   a receipt without it would be wrong, so such a tenant blocks the receipt.
 * - `herdeiros`, and amount types other than rent (`CAUCAO`, `ADIANT`): every receipt here is
 *   rent for the month it pays, `ARREND` and `RENDAC`.
 */

export interface AtLandlord {
  name: string;
  /** A Portuguese NIF, as stored: nine digits. */
  nif: string | null;
}

export interface AtTenant {
  name: string;
  nif: string | null;
  /** The country of `nif`, or of the document when there is no NIF. None reads as Portugal. */
  country: string | null;
  document: string | null;
}

export interface AtReceiptInput {
  contractNumber: string | null;
  contractVersion: number | null;
  landlords: AtLandlord[];
  /** The lease's tenant, then its co-tenants. Never a guarantor: a receipt names who pays. */
  tenants: AtTenant[];
  year: number;
  month: number;
  /** What the payment put towards this month, in euros. */
  amount: number;
  /** When the money arrived, `YYYY-MM-DD`. */
  receivedOn: string;
  /** The day the request would go, `YYYY-MM-DD`. */
  today: string;
}

export const AT_RECEIPT_BLOCKERS = [
  "contract_number_missing",
  "contract_number_invalid",
  "landlord_missing",
  "landlord_nif_missing",
  "landlord_nif_invalid",
  "tenant_missing",
  "tenant_nif_missing",
  "tenant_nif_invalid",
  "tenant_entity",
  "tenant_document_missing",
  "amount_not_positive",
  "received_in_future",
] as const;

export type AtReceiptBlockerCode = (typeof AT_RECEIPT_BLOCKERS)[number];

export interface AtReceiptBlocker {
  code: AtReceiptBlockerCode;
  /** The landlord or tenant it is about. */
  name?: string;
}

/**
 * At most this many months go to AT in one test: each is a call that can take seconds. Here rather
 * than in the service so the screen, which cannot import the service, counts the same way.
 */
export const MAX_TEST_MONTHS = 12;

/** AT's contract numbers are `long`: up to 18 digits is always one. */
const CONTRACT_NUMBER = /^\d{1,18}$/;

/** An individual's NIF starts 1, 2 or 3, or 45 for a non-resident; any other is an entity's. */
const INDIVIDUAL_NIF = /^(?:[123]|45)/;

const pad = (value: number) => String(value).padStart(2, "0");

/** The first and last day of a month, as AT reads a period. */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(lastDay)}` };
}

const isPortuguese = (country: string | null) => (country || "PT").toUpperCase() === "PT";

/**
 * What stops AT's contract number being sent. These three checks, and the landlord's and the
 * tenant's below, are exported so that anything else that asks "is this field good enough for a
 * receipt?", such as the owner's list of missing data, shares this answer with the review.
 */
export function contractNumberBlocker(
  contractNumber: string | null | undefined,
): "contract_number_missing" | "contract_number_invalid" | null {
  const contract = contractNumber?.trim();
  if (!contract) return "contract_number_missing";
  return CONTRACT_NUMBER.test(contract) ? null : "contract_number_invalid";
}

/** A landlord is named by a valid NIF. */
export function landlordBlockers(landlord: AtLandlord): AtReceiptBlocker[] {
  const name = landlord.name;
  if (!landlord.nif) return [{ code: "landlord_nif_missing", name }];
  if (!validatePortugueseNIF(landlord.nif)) return [{ code: "landlord_nif_invalid", name }];
  return [];
}

/** A tenant is named by a valid individual's NIF, or, from abroad, by a document. */
export function tenantBlockers(tenant: AtTenant): AtReceiptBlocker[] {
  const name = tenant.name;
  if (!isPortuguese(tenant.country)) {
    return tenant.document?.trim() ? [] : [{ code: "tenant_document_missing", name }];
  }
  if (!tenant.nif) return [{ code: "tenant_nif_missing", name }];
  if (!validatePortugueseNIF(tenant.nif)) return [{ code: "tenant_nif_invalid", name }];
  if (!INDIVIDUAL_NIF.test(tenant.nif)) return [{ code: "tenant_entity", name }];
  return [];
}

/** Everything that stops this month's receipt, in the order the owner would fix it. */
export function receiptBlockers(input: AtReceiptInput): AtReceiptBlocker[] {
  const blockers: AtReceiptBlocker[] = [];

  const contract = contractNumberBlocker(input.contractNumber);
  if (contract) blockers.push({ code: contract });

  if (input.landlords.length === 0) blockers.push({ code: "landlord_missing" });
  for (const landlord of input.landlords) blockers.push(...landlordBlockers(landlord));

  if (input.tenants.length === 0) blockers.push({ code: "tenant_missing" });
  for (const tenant of input.tenants) blockers.push(...tenantBlockers(tenant));

  if (round2(input.amount) <= 0) blockers.push({ code: "amount_not_positive" });
  // Both are YYYY-MM-DD, which compare as dates.
  if (input.receivedOn > input.today) blockers.push({ code: "received_in_future" });

  return blockers;
}

function tenantField(tenant: AtTenant): EmitirReciboTenant {
  return isPortuguese(tenant.country)
    ? { nif: tenant.nif ?? "", pais: "PT" }
    : {
        docIdentificacao: (tenant.document ?? "").trim(),
        pais: (tenant.country ?? "").toUpperCase(),
      };
}

/**
 * The request for one month, or its blockers. `issuerNif` is the NIF of the Portal user Situs signs
 * in as (`<NIF>/<n>`): AT records it as the receipt's issuer.
 */
export function buildReceiptRequest(
  input: AtReceiptInput,
  issuerNif: string,
): { ok: true; fields: EmitirReciboFields } | { ok: false; blockers: AtReceiptBlocker[] } {
  const blockers = receiptBlockers(input);
  if (blockers.length > 0) return { ok: false, blockers };

  const { start, end } = monthBounds(input.year, input.month);
  return {
    ok: true,
    fields: {
      numeroContrato: (input.contractNumber ?? "").trim(),
      ...(input.contractVersion === null ? {} : { versaoContrato: input.contractVersion }),
      nifEmitente: issuerNif,
      locadores: input.landlords.map((landlord) => ({ nif: landlord.nif ?? "" })),
      locatarios: input.tenants.map(tenantField),
      tipo: "ARREND",
      dataInicio: start,
      dataFim: end,
      tipoImportancia: "RENDAC",
      valor: round2(input.amount).toFixed(2),
      dataRecebimento: input.receivedOn,
    },
  };
}
