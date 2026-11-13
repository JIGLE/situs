import { csrfHeaders } from "@/lib/utils/api-client";
import { httpError } from "@/lib/utils/api-error";
import type { ParsedCaderneta, PropertyDraft } from "@/lib/services/financas-import/caderneta";
import type { ParsedContract } from "@/lib/services/financas-import/contract";
import type { ParsedRentReceipt } from "@/lib/services/financas-import/rent-receipt";
import type {
  ReceiptProposal,
  RegisterReceiptResult,
} from "@/lib/services/receipts/financas-receipts";

/**
 * Sends a PDF from the Portal das Finanças to be read (`app/api/financas-import`). Nothing is
 * stored: the answer is what the PDF says, for the owner to confirm. Throws `httpError(status)`,
 * which `useApiError` and the import screens turn into a sentence.
 */
async function read<T>(kind: "caderneta" | "contract" | "receipt", file: File): Promise<T> {
  const res = await fetch(`/api/financas-import?kind=${kind}`, {
    method: "POST",
    headers: csrfHeaders({ "Content-Type": "application/pdf" }),
    body: file,
  });
  if (!res.ok) throw httpError(res.status);
  const body = (await res.json()) as { data?: T };
  if (!body?.data) throw httpError(500);
  return body.data;
}

export function readCaderneta(
  file: File,
): Promise<{ document: ParsedCaderneta; drafts: PropertyDraft[] }> {
  return read("caderneta", file);
}

export async function readContractProof(file: File): Promise<ParsedContract> {
  const { contract } = await read<{ contract: ParsedContract }>("contract", file);
  return contract;
}

/** The HTTP status a read failed with, for the screens that say why per file. */
export function failureStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/** A recibo de renda, read: what it says and which contract and month it pays. */
export function readRentReceipt(
  file: File,
): Promise<{ receipt: ParsedRentReceipt; proposal: ReceiptProposal }> {
  return read("receipt", file);
}

/**
 * Puts a recibo on the ledger for the contract and month the owner confirmed
 * (`POST /api/receipts/financas`). The server reads the PDF again for its figures.
 */
export async function registerRentReceipt(
  file: File,
  leaseId: string,
  month: string,
  allowTermChange = false,
): Promise<RegisterReceiptResult> {
  const query = new URLSearchParams({
    leaseId,
    month,
    name: file.name.slice(0, 200),
    allowTermChange: allowTermChange ? "1" : "0",
  });
  const res = await fetch(`/api/receipts/financas?${query}`, {
    method: "POST",
    headers: csrfHeaders({ "Content-Type": "application/pdf" }),
    body: file,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { reason?: string } | null;
    throw Object.assign(httpError(res.status), body?.reason ? { reason: body.reason } : {});
  }
  const body = (await res.json()) as { data?: RegisterReceiptResult };
  if (!body?.data) throw httpError(500);
  return body.data;
}
