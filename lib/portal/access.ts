import type { ComponentType } from "react";
import {
  BarChart2,
  Building2,
  Calculator,
  FileBarChart,
  FileBox,
  FileText,
  HardHat,
  Home,
  Mail,
  Palette,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

export type PortalRole = "owner" | "tenant";

export interface PortalNavItem {
  key: string;
  href: string;
  label: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  roles: PortalRole[];
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
        roles: ["owner", "tenant"],
        mobilePrimary: true,
      },
      {
        key: "properties",
        href: "/portfolio",
        label: "Portfolio",
        labelKey: "navigation.portfolio",
        icon: Building2,
        roles: ["owner", "tenant"],
        mobilePrimary: true,
      },
      {
        key: "financials",
        href: "/financials",
        label: "Finance",
        labelKey: "navigation.finance",
        icon: Wallet,
        roles: ["owner", "tenant"],
        mobilePrimary: true,
      },
      {
        key: "maintenance",
        href: "/operations",
        label: "Operations",
        labelKey: "navigation.operations",
        icon: Wrench,
        roles: ["owner"],
      },
      {
        key: "people",
        href: "/people",
        label: "People",
        labelKey: "navigation.people",
        icon: Users,
        roles: ["owner"],
        mobilePrimary: true,
      },
      {
        key: "documents",
        href: "/documents",
        label: "Documents",
        labelKey: "navigation.documents",
        icon: FileBox,
        roles: ["owner", "tenant"],
        mobilePrimary: true,
      },
      {
        key: "analytics",
        href: "/intelligence",
        label: "Intelligence",
        labelKey: "navigation.intelligence",
        icon: BarChart2,
        roles: ["owner"],
      },
    ],
  },
  {
    group: "System",
    groupLabelKey: "navigation.systemGroup",
    items: [
      {
        // Both roles: Settings now hosts the Account section, which a tenant must be able to
        // reach. The sections themselves are filtered by role inside `settings-view.tsx` — a
        // tenant sees Account and Appearance, not tax rules or billing.
        key: "settings",
        href: "/settings",
        label: "Settings",
        labelKey: "navigation.settings",
        icon: Settings,
        roles: ["owner", "tenant"],
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
        roles: ["owner"],
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
        key: "reports",
        href: "/intelligence",
        label: "Reports",
        labelKey: "navigation.reports",
        icon: FileBarChart,
        roles: ["owner"],
        hidden: true,
      },
      {
        key: "correspondence",
        href: "/correspondence",
        label: "Messages",
        labelKey: "navigation.correspondence",
        icon: Mail,
        roles: ["owner"],
        hidden: true,
      },
      {
        key: "compliance",
        href: "/compliance/modelo179",
        label: "Compliance",
        labelKey: "navigation.compliance",
        icon: ShieldCheck,
        roles: ["owner"],
        hidden: true,
      },
      {
        key: "tax-filing",
        href: "/compliance/tax-filing",
        label: "Tax Filing",
        labelKey: "navigation.taxFiling",
        icon: Calculator,
        roles: ["owner"],
        hidden: true,
      },
      {
        key: "leases",
        href: "/leases",
        label: "Leases",
        labelKey: "navigation.leases",
        icon: FileText,
        roles: ["owner", "tenant"],
        hidden: true,
      },
      {
        key: "vendors",
        href: "/contacts",
        label: "Vendors",
        labelKey: "navigation.vendors",
        icon: HardHat,
        roles: ["owner"],
        hidden: true,
      },
      {
        // Folded into Settings as its Account section; `/account` redirects there. Kept here
        // so `canAccessPortalPath` still permits the old URL for both roles.
        key: "account",
        href: "/account",
        label: "Account",
        labelKey: "navigation.account",
        icon: UserCircle,
        roles: ["owner", "tenant"],
        hidden: true,
      },
      {
        // Internal dev/admin reference only — the page itself 404s in
        // production (NODE_ENV check). Never shown in the nav rail; this
        // entry exists only so canAccessPortalPath permits the direct URL.
        key: "brand",
        href: "/brand",
        label: "Brand",
        labelKey: "navigation.brand",
        icon: Palette,
        roles: ["owner"],
        hidden: true,
      },
    ],
  },
];

export function getPortalRoleFromSessionRole(role?: string | null): PortalRole {
  return role === "USER" ? "tenant" : "owner";
}

export function getPortalNavigation(role: PortalRole): PortalNavGroup[] {
  return PORTAL_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role) && !item.hidden),
  })).filter((group) => group.items.length > 0);
}

export function getPrimaryMobileNavigation(role: PortalRole): PortalNavItem[] {
  return getPortalNavigation(role)
    .flatMap((group) => group.items)
    .filter((item) => item.mobilePrimary)
    .slice(0, 5);
}

export function getSecondaryMobileNavigation(role: PortalRole): PortalNavItem[] {
  const primaryKeys = new Set(getPrimaryMobileNavigation(role).map((item) => item.key));
  return getPortalNavigation(role)
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
  if (normalized === "/vendors") return "/contacts";
  // Redirect-only stubs. A page absent from this table is unreachable no matter what it renders,
  // because `PortalAccessGuard` replaces the route with /dashboard before the stub's own
  // `redirect()` can run — the same trap /admin fell into (see the note on its nav entry). Both
  // of these rendered a redirect to the right place and the guard threw it away first.
  if (normalized === "/buildings") return "/portfolio";
  if (normalized === "/contracts") return "/leases";
  if (normalized === "/owners") return "/people";
  if (normalized === "/maintenance") return "/operations";
  if (normalized === "/analytics" || normalized === "/insights" || normalized === "/reports") {
    return "/intelligence";
  }
  return normalized;
}

export function canAccessPortalPath(role: PortalRole, pathname: string): boolean {
  const normalizedPath = normalizePortalPath(pathname);
  const allowedItems = PORTAL_NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => item.roles.includes(role)),
  );
  // Match exact href OR check if the normalized path is a prefix of a nav item's href
  return allowedItems.some(
    (item) => item.href === normalizedPath || item.href.startsWith(normalizedPath + "/"),
  );
}
