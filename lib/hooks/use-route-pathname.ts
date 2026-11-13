"use client";

import { usePathname } from "next/navigation";
import { locales } from "@/lib/i18n/locales";

/** `/pt/settings` → `/settings`; a path with no locale segment is returned as it is. */
export function stripLocalePrefix(pathname: string): string {
  const first = pathname.split("/")[1] ?? "";
  if (!(locales as readonly string[]).includes(first)) return pathname;
  return pathname.slice(first.length + 1) || "/";
}

/**
 * The route the address bar shows, on the server as in the browser.
 *
 * `proxy.ts` rewrites `/settings` to `/pt/settings` internally, and `usePathname` from
 * `next/navigation` returns that rewritten path during the server render but the bare one in the
 * browser. Anything drawn from it (the phone's section title, the breadcrumb trail, the active menu
 * item, the access guard) then differed between the two, and every page failed hydration (React
 * #418) and was rendered again from scratch in the browser. Read the path through this hook instead;
 * `tests/route-pathname-contract.test.ts` names a component that does not.
 */
export function useRoutePathname(): string {
  return stripLocalePrefix(usePathname() ?? "");
}
