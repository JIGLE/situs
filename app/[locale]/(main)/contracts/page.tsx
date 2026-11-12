import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Contracts is Leases, which is Portfolio's Leases tab. The proxy answers first (`proxy.ts`); this
 *  is the fallback, and the target has to be the canonical locale-less path. */
export default function ContractsPage() {
  redirect("/portfolio?tab=leases");
}
