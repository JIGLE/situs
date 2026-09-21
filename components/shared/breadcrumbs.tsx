"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { useApp } from "@/lib/contexts/app-context";

/** Human-readable labels for known route segments */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  overview: "Dashboard",
  tenants: "Tenants",
  people: "Tenants",
  properties: "Properties",
  portfolio: "Properties",
  leases: "Leases",
  financials: "Finance",
  settings: "Settings",
  correspondence: "Messages",
  contacts: "Contacts",
  owners: "Owners",
  contracts: "Contracts",
  documents: "Documents",
  insights: "Intelligence",
  analytics: "Intelligence",
  reports: "Intelligence",
  intelligence: "Intelligence",
  brand: "Brand",
};

export interface BreadcrumbOverride {
  /** The entity name to display for dynamic [id] segments, e.g. "Apt T2 Rua das Flores" */
  label: string;
  /** Optional href override for the segment */
  href?: string;
}

interface BreadcrumbsProps {
  /** Override labels for dynamic segments (keyed by segment value, e.g. the entity id) */
  overrides?: Record<string, BreadcrumbOverride>;
  className?: string;
}

export function Breadcrumbs({ overrides, className }: BreadcrumbsProps) {
  const t = useTranslations("common");
  const tNav = useTranslations("navigation");
  const pathname = usePathname();
  const { state } = useApp();

  // Split pathname: /properties/123 → ["properties", "123"]. This used to drop segments[0] as
  // the locale, which was right only while every URL carried a prefix — unprefixed it threw
  // away the section itself, so /portfolio/123 became a one-crumb path and rendered nothing.
  const routeSegments = pathname.split("/").filter(Boolean);

  if (routeSegments.length <= 1) {
    // On top-level pages (e.g. /dashboard), no breadcrumb needed
    return null;
  }

  const crumbs = routeSegments.map((segment, index) => {
    const href = `/${routeSegments.slice(0, index + 1).join("/")}`;
    const isLast = index === routeSegments.length - 1;

    // Check for overrides first (for dynamic segments like entity ids)
    const override = overrides?.[segment];

    let label: string;
    if (override?.label) {
      label = override.label;
    } else if (SEGMENT_LABELS[segment]) {
      label = SEGMENT_LABELS[segment];
    } else {
      // Try to resolve the segment as an entity ID
      const property = state.properties?.find((p) => p.id === segment);
      const tenant = state.tenants?.find((t) => t.id === segment);
      const lease = state.leases?.find((l) => l.id === segment);
      label =
        property?.name ||
        tenant?.name ||
        (lease ? `Lease ${lease.id.slice(0, 8)}` : null) ||
        decodeURIComponent(segment);
    }

    return { segment, href: override?.href || href, label, isLast };
  });

  return (
    <nav
      aria-label={t("breadcrumb")}
      className={cn("flex items-center gap-1.5 text-sm", className)}
    >
      {/* Home icon linking to dashboard */}
      <Link
        href={"/dashboard"}
        className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        aria-label={tNav("dashboard")}
      >
        <Home className="h-4 w-4" />
      </Link>

      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" aria-hidden />
          {crumb.isLast ? (
            <span className="font-medium text-[var(--color-foreground)]" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
