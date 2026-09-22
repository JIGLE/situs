"use client";

import { cn } from "@/lib/utils/utils";
import { Building2, Users, FileText, Calendar, AlertCircle } from "lucide-react";

type BadgeVariant = "property" | "tenant" | "lease" | "expiry" | "overdue";

const VARIANT_CONFIG: Record<
  BadgeVariant,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  // Each entity type maps to a semantic / brand design token (no raw Tailwind colors).
  property: {
    icon: Building2,
    className:
      "bg-[color-mix(in_oklab,var(--color-info)_12%,transparent)] text-[var(--color-info)] border-[color-mix(in_oklab,var(--color-info)_25%,transparent)]",
  },
  tenant: {
    icon: Users,
    className:
      "bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)] border-[color-mix(in_oklab,var(--color-success)_25%,transparent)]",
  },
  lease: {
    icon: FileText,
    className:
      "bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)] border-[color-mix(in_oklab,var(--color-primary)_25%,transparent)]",
  },
  expiry: {
    icon: Calendar,
    className:
      "bg-[color-mix(in_oklab,var(--color-accent-secondary)_14%,transparent)] text-[var(--color-accent-secondary)] border-[color-mix(in_oklab,var(--color-accent-secondary)_28%,transparent)]",
  },
  overdue: {
    icon: AlertCircle,
    className:
      "bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)] text-[var(--color-error)] border-[color-mix(in_oklab,var(--color-error)_25%,transparent)]",
  },
};

interface RelationshipBadgeProps {
  variant: BadgeVariant;
  label: string;
  count?: number;
  className?: string;
}

export function RelationshipBadge({ variant, label, count, className }: RelationshipBadgeProps) {
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] md:text-[10px] font-medium leading-tight",
        config.className,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {count !== undefined ? (
        <span>
          {count} {label}
        </span>
      ) : (
        <span className="truncate max-w-[120px]">{label}</span>
      )}
    </span>
  );
}

/**
 * Helper to compute days until a date. Returns null if date is invalid.
 */
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
