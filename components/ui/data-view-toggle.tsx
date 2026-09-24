"use client";

import { LayoutGrid, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

export type DataViewMode = "grid" | "table";

interface DataViewToggleProps {
  mode: DataViewMode;
  onChange: (mode: DataViewMode) => void;
  className?: string;
}

export function DataViewToggle({ mode, onChange, className }: DataViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn("flex items-center gap-1 border border-[var(--color-border)] p-0.5", className)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(mode === "grid" && "bg-[var(--color-hover)] text-[var(--color-foreground)]")}
        onClick={() => onChange("grid")}
        aria-label="Card view"
        aria-pressed={mode === "grid"}
        title="Card view"
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(mode === "table" && "bg-[var(--color-hover)] text-[var(--color-foreground)]")}
        onClick={() => onChange("table")}
        aria-label="Table view"
        aria-pressed={mode === "table"}
        title="Table view"
      >
        <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
