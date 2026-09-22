"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, Users, UserCircle, FileText, FileIcon, Receipt } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { Badge } from "@/components/ui/badge";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";

type EntityType = "property" | "tenant" | "owner" | "lease" | "document" | "receipt";

/**
 * Entities with `overlay: true` open the shared `?detail=<type>:<id>` overlay
 * on the current page instead of navigating to a full-page route — `basePath`
 * is unused for those. Receipt has no overlay yet and keeps
 * navigating to their existing full-page destination.
 */
const ENTITY_CONFIG: Record<
  EntityType,
  {
    icon: React.ComponentType<{ className?: string }>;
    basePath?: string;
    overlay?: boolean;
    color: string;
  }
> = {
  property: { icon: Building2, overlay: true, color: "text-blue-500" },
  tenant: { icon: Users, overlay: true, color: "text-emerald-500" },
  owner: { icon: UserCircle, overlay: true, color: "text-sky-500" },
  lease: { icon: FileText, overlay: true, color: "text-violet-500" },
  document: { icon: FileIcon, overlay: true, color: "text-[var(--color-muted-foreground)]" },
  receipt: { icon: Receipt, basePath: "/financials", color: "text-green-500" },
};

export interface EntityLinkProps {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  statusVariant?: "default" | "success" | "warning" | "destructive";
  variant?: "badge" | "card" | "full";
  className?: string;
}

export function EntityLink({
  type,
  id,
  title,
  subtitle,
  status,
  statusVariant = "default",
  variant = "card",
  className,
}: EntityLinkProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const config = ENTITY_CONFIG[type];
  const Icon = config.icon;
  const href = config.overlay
    ? withEntityDetail(pathname, searchParams.toString(), type, id)
    : `${config.basePath}/${id}`;

  if (variant === "badge") {
    return (
      <Link
        href={href}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
          "bg-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] transition-colors",
          className,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
        <span className="truncate max-w-[150px]">{title}</span>
      </Link>
    );
  }

  if (variant === "card") {
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)]",
          "hover:bg-[var(--color-surface-hover)] transition-colors group",
          className,
        )}
      >
        <div className={cn("p-2 rounded-lg bg-[var(--color-muted)]")}>
          <Icon className={cn("h-4 w-4", config.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-foreground)] truncate group-hover:underline">
            {title}
          </p>
          {subtitle && (
            <p className="text-xs text-[var(--color-muted-foreground)] truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {status && (
          <Badge
            variant={
              statusVariant === "success"
                ? "default"
                : statusVariant === "warning"
                  ? "secondary"
                  : statusVariant === "destructive"
                    ? "destructive"
                    : "outline"
            }
          >
            {status}
          </Badge>
        )}
      </Link>
    );
  }

  // Full variant
  return (
    <Link
      href={href}
      className={cn(
        "block p-4 rounded-xl border border-[var(--color-border)]",
        "hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary)]/30 transition-all group",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("p-2.5 rounded-xl bg-[var(--color-muted)]")}>
          <Icon className={cn("h-5 w-5", config.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-foreground)] truncate group-hover:underline">
              {title}
            </p>
            {status && (
              <Badge
                variant={
                  statusVariant === "success"
                    ? "default"
                    : statusVariant === "warning"
                      ? "secondary"
                      : statusVariant === "destructive"
                        ? "destructive"
                        : "outline"
                }
              >
                {status}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{subtitle}</p>
          )}
        </div>
      </div>
    </Link>
  );
}
