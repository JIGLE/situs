import { redirect } from "next/navigation";

/**
 * Leases is Portfolio's Leases tab. The address it had still works, with its query: a link to
 * `/leases?action=create` or `/leases?detail=lease:<id>` opens the same thing there.
 */
export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, one);
    }
  }
  params.set("tab", "leases");
  redirect(`/portfolio?${params.toString()}`);
}
