"use client";

import { useTranslations } from "next-intl";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { SortDirection } from "@/lib/hooks/use-sortable-data";

export interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: SortDirection;
  onSort: (key: string) => void;
}

export function SortableHeader({ label, sortKey, currentSort, onSort }: SortableHeaderProps) {
  const t = useTranslations("common");
  const ariaSort =
    currentSort === "asc" ? "ascending" : currentSort === "desc" ? "descending" : "none";

  // min-h-6: at 16px tall on desktop the button failed WCAG 2.2's 24px target minimum.
  return (
    <button
      onClick={() => onSort(sortKey)}
      aria-sort={ariaSort}
      aria-label={
        currentSort === "asc"
          ? t("sortByAscending", { label })
          : currentSort === "desc"
            ? t("sortByDescending", { label })
            : t("sortBy", { label })
      }
      className="flex min-h-6 items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors max-md:min-h-11 max-md:min-w-11"
    >
      {label}
      {currentSort === "asc" && <ArrowUp className="w-3 h-3" aria-hidden="true" />}
      {currentSort === "desc" && <ArrowDown className="w-3 h-3" aria-hidden="true" />}
      {currentSort === null && <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" />}
    </button>
  );
}
