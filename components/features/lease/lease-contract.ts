import { csrfHeaders } from "@/lib/utils/api-client";
import { httpError } from "@/lib/utils/api-error";

/**
 * A lease's contract PDF, through its own route (app/api/leases/[id]/contract). The lease list
 * does not carry the bytes; this is the only way to them from the browser.
 */

/** Upload the PDF itself. The route checks its first bytes, its size and the owner. */
export async function uploadContract(leaseId: string, file: File): Promise<void> {
  const res = await fetch(`/api/leases/${leaseId}/contract`, {
    method: "PUT",
    headers: csrfHeaders({
      "Content-Type": "application/pdf",
      "X-File-Name": encodeURIComponent(file.name),
    }),
    body: file,
  });
  if (!res.ok) throw httpError(res.status);
}

/** Download the stored PDF under its own name. Throws with the HTTP status when it cannot. */
export async function downloadContract(lease: {
  id: string;
  contractFileName?: string | null;
}): Promise<void> {
  const res = await fetch(`/api/leases/${lease.id}/contract`);
  if (!res.ok) throw httpError(res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = lease.contractFileName || `lease-${lease.id}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
