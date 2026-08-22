import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Buildings management folded into Portfolio. This page only forwards.
 *
 * It forwarded to the right place for a long time and nobody arrived, because the redirect never
 * got to run: `PortalAccessGuard` replaces any route `canAccessPortalPath` rejects with
 * /dashboard, and that check derives from `PORTAL_NAV_GROUPS` plus the alias table in
 * `lib/portal/access.ts`. A redirect-only stub belongs to neither, so the guard fired first. The
 * alias entry is the actual fix; this file is only correct once that exists.
 *
 * The target is the canonical locale-less path. `../portfolio` (what this used to say) is never
 * resolved by the client router, and `/${locale}/portfolio` earns an extra 308 from `proxy.ts`,
 * which strips the prefix back off again. Both were measured; both left the browser somewhere
 * other than Portfolio.
 */
export default function BuildingsPage() {
  redirect("/portfolio");
}
