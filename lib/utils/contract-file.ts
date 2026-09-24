/**
 * A lease's contract PDF: the size the upload accepts, and the name it is stored under. Shared by
 * the contract route (app/api/leases/[id]/contract) and the form that uploads to it, so the limit
 * the form states is the one the server applies.
 */

/**
 * Under the 25 MB `proxyClientMaxBodySize` in next.config.ts: behind the proxy, Next buffers a
 * request body only up to that limit and drops the rest, so a larger upload would arrive cut short
 * rather than refused.
 */
export const MAX_CONTRACT_BYTES = 20 * 1024 * 1024;

/** The limit in megabytes, as the form states it. */
export const MAX_CONTRACT_MB = MAX_CONTRACT_BYTES / (1024 * 1024);

/** The name to store: the uploaded file's, without a path or control characters, ending `.pdf`. */
export function contractFileName(header: string | null, leaseId: string): string {
  let name = "";
  try {
    name = header ? decodeURIComponent(header) : "";
  } catch {
    name = "";
  }
  name = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  name = name.slice(0, 150);
  if (!name) return `contract-${leaseId}.pdf`;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
