import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Contracts is Leases. See buildings/page.tsx — the alias in lib/portal/access.ts is what makes
 *  this reachable, and the target has to be the canonical locale-less path. */
export default function ContractsPage() {
  redirect("/leases");
}
