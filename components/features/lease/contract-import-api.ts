import { csrfHeaders } from "@/lib/utils/api-client";
import { httpError } from "@/lib/utils/api-error";
import type { ContractExtraction, ContractImport } from "@/lib/services/contracts/schema";
import type { ContractMatches } from "@/lib/services/contracts/match";

/**
 * The review sheet's calls to /api/contracts. A failure keeps its HTTP status (for
 * `useApiError`) and the route's `reason` code, which the sheet translates: nothing the server
 * wrote in English reaches the screen.
 */

export type ImportFailure = Error & { status?: number; reason?: string };

async function failure(res: Response): Promise<ImportFailure> {
  const error: ImportFailure = httpError(res.status);
  try {
    const body = (await res.json()) as { reason?: unknown };
    if (typeof body.reason === "string") error.reason = body.reason;
  } catch {
    // A body that is not JSON carries no reason; the status still says what happened.
  }
  return error;
}

/** Whether this instance can read contracts. False on any failure: the button just stays hidden. */
export async function fetchReaderConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/contracts/extract");
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: { configured?: boolean } };
    return body.data?.configured === true;
  } catch {
    return false;
  }
}

/** Send the PDFs to be read. `signal` lets the sheet walk away from a reading it no longer wants. */
export async function readContract(
  contract: File,
  registration: File | null,
  language: string,
  signal?: AbortSignal,
): Promise<{ reading: ContractExtraction; matches: ContractMatches }> {
  const form = new FormData();
  form.append("contract", contract);
  if (registration) form.append("registration", registration);
  form.append("language", language);
  // No Content-Type: the browser writes the multipart boundary itself.
  const res = await fetch("/api/contracts/extract", {
    method: "POST",
    headers: csrfHeaders(),
    body: form,
    signal,
  });
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as { data: { reading: ContractExtraction; matches: ContractMatches } })
    .data;
}

export async function importReviewed(
  review: ContractImport,
): Promise<{ leaseId: string; propertyId: string; tenantId: string }> {
  const res = await fetch("/api/contracts/import", {
    method: "POST",
    headers: csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(review),
  });
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as { data: { leaseId: string; propertyId: string; tenantId: string } })
    .data;
}
