import type { ComponentType } from "react";
import {
  Building2,
  Calculator,
  FileText,
  Home,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  Wallet,
} from "lucide-react";

/**
 * Whether a session may use the owner application at all.
 *
 * This replaced a two-member role union that every nav item carried a list of. The scope
 * cutdown removed both tenant-facing surfaces — the token portal and role=USER access to
 * this app — so every remaining route is an owner route and the per-item lists had
 * collapsed to one value repeated ten times.
 *
 * It stays a real check rather than becoming `true`: `User.role` still defaults to USER in
 * the schema, so a row can hold one even though the sign-in gate provisions ADMIN. A guard
 * that cannot fail is the shape this repo keeps finding, so the predicate survives and the
 * lists are what went.
 */
export function isOwnerSessionRole(role?: string | null): boolean {
  return role !== "USER";
}

export interface PortalNavItem {
  key: string;
  href: string;
  label: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  mobilePrimary?: boolean;
  hidden?: boolean;
}

export interface PortalNavGroup {
  group: string;
  groupLabelKey: string;
  items: PortalNavItem[];
}

// Situs // Sovereign Capital System information architecture (PR 2 of the rebrand):
// two groups — Core (the owner's daily surfaces) and System (configuration + identity) —
// mirroring the approved Mockup.html nav rail. Nav LABELS are the Situs pillars; Operations
// moved from `/maintenance` to `/operations` in PR 10b-1, Intelligence from `/analytics` to
// `/intelligence` in PR 10b-3 (old paths 301, plus `/insights` and `/reports` which the
// Intelligence tabs absorbed). Finance still serves from `/financials` — that route rename
// is unscoped/deferred. Consolidated surfaces (Reports, Compliance/Tax Filing,
// Messages, Leases, Vendors) are kept as `hidden` items so their routes stay permitted by
// `canAccessPortalPath` (which ignores `hidden`) and existing deep links keep working — they
// are reached from within their new home pillar rather than occupying their own rail row.
export const PORTAL_NAV_GROUPS: PortalNavGroup[] = [
  {
    group: "Core",
    groupLabelKey: "navigation.coreGroup",
    items: [
      {
        key: "dashboard",
        href: "/dashboard",
        label: "Home",
        labelKey: "navigation.home",
        icon: Home,
        mobilePrimary: true,
      },
      {
        key: "properties",
        href: "/portfolio",
        label: "Portfolio",
        labelKey: "navigation.portfolio",
        icon: Building2,
        mobilePrimary: true,
      },
      {
        key: "financials",
        href: "/financials",
        label: "Finance",
        labelKey: "navigation.finance",
        icon: Wallet,
        mobilePrimary: true,
      },
      {
        key: "people",
        href: "/people",
        label: "People",
        labelKey: "navigation.people",
        icon: Users,
        mobilePrimary: true,
      },
    ],
  },
  {
    group: "System",
    groupLabelKey: "navigation.systemGroup",
    items: [
      {
        key: "settings",
        href: "/settings",
        label: "Settings",
        labelKey: "navigation.settings",
        icon: Settings,
      },
      {
        // Owner-only. `canAccessPortalPath` derives access from this list, so a page absent
        // from it is unreachable no matter what it renders — /admin redirected to /dashboard
        // until this entry existed.
        //
        // The rail entry is a convenience; the real gate is `requireAdmin` on
        // /api/admin/system-status, so a non-admin owner reaching the page sees only the
        // "you may not have admin access" message and no system detail.
        key: "admin",
        href: "/admin",
        label: "System status",
        labelKey: "navigation.admin",
        icon: ShieldCheck,
      },
    ],
  },
  {
    // Hidden group: routes that no longer own a rail row but must stay reachable/permitted.
    // Reached from within their new home pillar (Intelligence, People, Property detail).
    group: "Hidden",
    groupLabelKey: "navigation.systemGroup",
    items: [
      {
        key: "compliance",
        href: "/compliance/modelo179",
        label: "Compliance",
        labelKey: "navigation.compliance",
        icon: ShieldCheck,
        hidden: true,
      },
      {
        key: "tax-filing",
        href: "/compliance/tax-filing",
        label: "Tax Filing",
        labelKey: "navigation.taxFiling",
        icon: Calculator,
        hidden: true,
      },
      {
        key: "leases",
        href: "/leases",
        label: "Leases",
        labelKey: "navigation.leases",
        icon: FileText,
        hidden: true,
      },
      {
        // Folded into Settings as its Account section; `/account` redirects there. Kept here
        // so `canAccessPortalPath` still permits the old URL.
        key: "account",
        href: "/account",
        label: "Account",
        labelKey: "navigation.account",
        icon: UserCircle,
        hidden: true,
      },
    ],
  },
];

export function getPortalNavigation(): PortalNavGroup[] {
  return PORTAL_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.hidden),
  })).filter((group) => group.items.length > 0);
}

export function getPrimaryMobileNavigation(): PortalNavItem[] {
  return getPortalNavigation()
    .flatMap((group) => group.items)
    .filter((item) => item.mobilePrimary)
    .slice(0, 5);
}

export function getSecondaryMobileNavigation(): PortalNavItem[] {
  const primaryKeys = new Set(getPrimaryMobileNavigation().map((item) => item.key));
  return getPortalNavigation()
    .flatMap((group) => group.items)
    .filter((item) => !primaryKeys.has(item.key));
}

/** Segments that are a language rather than a destination. */
const LOCALE_SEGMENTS = ["pt", "en", "es", "it"] as const;

export function normalizePortalPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);

  // Locale-agnostic on purpose. This used to take `segments[1]`, hardcoding the assumption that a
  // language segment came first — true while every URL was `/pt/portfolio`, and false the moment
  // the address bar lost the prefix. Stripping the segment only when it IS a locale keeps both
  // shapes correct, so `/en/portfolio` and `/portfolio` normalise identically and no caller has to
  // know which one it is holding.
  const rest =
    segments.length > 0 && (LOCALE_SEGMENTS as readonly string[]).includes(segments[0])
      ? segments.slice(1)
      : segments;

  if (rest.length === 0) {
    return "/dashboard";
  }
  const normalized = `/${rest[0]}`;
  if (normalized === "/overview") return "/dashboard";
  if (normalized === "/account") return "/settings";
  if (normalized === "/properties") return "/portfolio";
  if (normalized === "/tenants") return "/people";
  // Redirect-only stubs. A page absent from this table is unreachable no matter what it renders,
  // because `PortalAccessGuard` replaces the route with /dashboard before the stub's own
  // `redirect()` can run — the same trap /admin fell into (see the note on its nav entry). Both
  // of these rendered a redirect to the right place and the guard threw it away first.
  if (normalized === "/buildings") return "/portfolio";
  if (normalized === "/contracts") return "/leases";
  if (normalized === "/owners") return "/people";
  return normalized;
}

export function canAccessPortalPath(pathname: string): boolean {
  const normalizedPath = normalizePortalPath(pathname);
  const allowedItems = PORTAL_NAV_GROUPS.flatMap((group) => group.items);
  // Match exact href OR check if the normalized path is a prefix of a nav item's href
  return allowedItems.some(
    (item) => item.href === normalizedPath || item.href.startsWith(normalizedPath + "/"),
  );
}
