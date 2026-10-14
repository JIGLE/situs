"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Building2,
  Users,
  Receipt,
  FileText,
  BarChart3,
  Plus,
  ArrowRight,
  Briefcase,
  DollarSign,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils/utils";

export interface EmptyStateIllustrationProps {
  /** Which entity type this empty state is for */
  type?:
    | "properties"
    | "tenants"
    | "payments"
    | "leases"
    | "reports"
    | "generic"
    | "owners"
    | "receipts"
    | "expenses"
    | "invoices"
    | "contracts"
    | "documents";
  /** Alias for type (backwards compatibility) */
  entityType?:
    | "properties"
    | "tenants"
    | "payments"
    | "leases"
    | "reports"
    | "generic"
    | "owners"
    | "receipts"
    | "expenses"
    | "invoices"
    | "contracts"
    | "documents";
  /** Title override (defaults based on type) */
  title?: string;
  /** Description override (defaults based on type) */
  description?: string;
  /** Primary CTA callback */
  onAction?: () => void;
  /** Primary CTA label override */
  actionLabel?: string;
  /** Secondary CTA callback */
  onSecondaryAction?: () => void;
  /** Secondary CTA label */
  secondaryActionLabel?: string;
  /** Additional CSS classes */
  className?: string;
  /** Compact mode (less padding/smaller) */
  compact?: boolean;
}

// Icon and color treatment per entity type — text comes from the "emptyState"
// i18n namespace (see messages/*.json), looked up by type in the component.
/** Every empty state wears the same neutral treatment; the icon says which one it is. */
const EMPTY_GRADIENT = "from-[var(--color-muted)] to-[var(--color-card)]";
const EMPTY_ACCENT = "text-[var(--color-muted-foreground)]";

const emptyStateMeta: Record<
  string,
  {
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  properties: {
    icon: Building2,
  },
  tenants: {
    icon: Users,
  },
  payments: {
    icon: Receipt,
  },
  leases: {
    icon: FileText,
  },
  reports: {
    icon: BarChart3,
  },
  generic: {
    icon: Plus,
  },
  owners: {
    icon: Briefcase,
  },
  receipts: {
    icon: Receipt,
  },
  expenses: {
    icon: DollarSign,
  },
  invoices: {
    icon: FileSpreadsheet,
  },
  contracts: {
    icon: FileText,
  },
  documents: {
    icon: FileText,
  },
};

export function EmptyStateIllustration({
  type,
  entityType,
  title,
  description,
  onAction,
  actionLabel,
  onSecondaryAction,
  secondaryActionLabel,
  className,
  compact = false,
}: EmptyStateIllustrationProps): React.ReactElement {
  const t = useTranslations("emptyState");
  const resolvedType = type || entityType || "generic";
  const meta = emptyStateMeta[resolvedType] || emptyStateMeta.generic;
  const Icon = meta.icon;
  const resolvedTitle = title || t(`${resolvedType}.title`);
  const resolvedDescription = description || t(`${resolvedType}.description`);
  const resolvedActionLabel = actionLabel || t(`${resolvedType}.action`);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
        className,
      )}
    >
      {/* Animated Icon with gradient background */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4, ease: "easeOut" }}
        className={cn("relative bg-gradient-to-br p-6 mb-6", EMPTY_GRADIENT)}
      >
        {/* Decorative ring */}
        <div className="absolute inset-0 border border-[var(--color-border)] opacity-50" />

        {/* Floating particles (decorative) */}
        <motion.div
          animate={{ y: [-4, 4, -4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          <Icon className={cn(EMPTY_ACCENT, compact ? "h-10 w-10" : "h-14 w-14")} />
        </motion.div>

        {/* Small decorative dots */}
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
          className={cn(
            "absolute -top-1 -right-1 h-3 w-3 rounded-full",
            EMPTY_ACCENT.replace("text-", "bg-"),
          )}
        />
        <motion.div
          animate={{ opacity: [0.5, 0.2, 0.5] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: 1 }}
          className={cn(
            "absolute -bottom-1 -left-1 h-2 w-2 rounded-full",
            EMPTY_ACCENT.replace("text-", "bg-"),
          )}
        />
      </motion.div>

      {/* Title */}
      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className={cn(
          "font-semibold text-[var(--color-foreground)] mb-2",
          compact ? "text-base" : "text-lg",
        )}
      >
        {resolvedTitle}
      </motion.h3>

      {/* Description */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className={cn(
          "text-[var(--color-muted-foreground)] mb-6 max-w-sm",
          compact ? "text-xs" : "text-sm",
        )}
      >
        {resolvedDescription}
      </motion.p>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-3"
      >
        {onAction && (
          <Button onClick={onAction} className="gap-2">
            <Plus className="h-4 w-4" />
            {resolvedActionLabel}
          </Button>
        )}
        {onSecondaryAction && secondaryActionLabel && (
          <Button variant="outline" onClick={onSecondaryAction} className="gap-2">
            {secondaryActionLabel}
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}
