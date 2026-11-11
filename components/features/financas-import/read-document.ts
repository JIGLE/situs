import { csrfHeaders } from "@/lib/utils/api-client";
import { httpError } from "@/lib/utils/api-error";
import type { ParsedCaderneta, PropertyDraft } from "@/lib/services/financas-import/caderneta";
import type { ParsedContract } from "@/lib/services/financas-import/contract";

/**
 * Sends a PDF from the Portal das Finanças to be read (`app/api/financas-import`). Nothing is
 * stored: the answer is what the PDF says, for the owner to confirm. Throws `httpError(status)`,
 * which `useApiError` and the import screens turn into a sentence.
 */
async function read<T>(kind: "caderneta" | "contract", file: File): Promise<T> {
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
