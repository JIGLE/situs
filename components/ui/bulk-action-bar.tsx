"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, Download, CheckSquare, Square, MoreHorizontal } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./dropdown-menu";

export interface BulkAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "destructive";
  onClick: (selectedIds: string[]) => void | Promise<void>;
  /** Show in dropdown menu instead of main bar */
  inMenu?: boolean;
}

interface BulkActionBarProps {
  /** Number of selected items */
  selectedCount: number;
  /** Total number of items available */
  totalCount: number;
  /** Label for items (e.g., "tenants", "properties") */
  itemLabel?: string;
  /** Available actions */
  actions: BulkAction[];
  /** Callback to select all items */
  onSelectAll: () => void;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Whether all items are selected */
  isAllSelected: boolean;
  /** Whether some items are selected */
  isPartiallySelected: boolean;
  /** Array of selected IDs to pass to actions */
  selectedIds: string[];
  /** Additional class names */
  className?: string;
}

/**
 * Floating action bar that appears when items are selected
 * Provides bulk operations like delete, export, status change
 */
export function BulkActionBar({
  selectedCount,
  totalCount,
  itemLabel = "items",
  actions,
  onSelectAll,
  onClearSelection,
  isAllSelected,
  isPartiallySelected,
  selectedIds,
  className,
}: BulkActionBarProps): React.ReactElement | null {
  const [loadingAction, setLoadingAction] = React.useState<string | null>(null);

  // Separate main actions from menu actions
  const mainActions = actions.filter((a) => !a.inMenu);
  const menuActions = actions.filter((a) => a.inMenu);

  const handleAction = async (action: BulkAction) => {
    setLoadingAction(action.id);
    try {
      await action.onClick(selectedIds);
    } finally {
      setLoadingAction(null);
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn(
          // `bottom-6` is 24px, and the mobile bottom nav is 64px + the safe-area inset — so on a
          // phone this bar rendered entirely behind it and its actions could not be reached at
          // all. Sit above the nav below `md`; keep the 24px offset once the nav is gone.
          "fixed left-1/2 z-50 -translate-x-1/2",
          "max-md:bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6",
          "flex items-center gap-3 px-4 py-3 rounded-xl",
          "bg-[var(--color-popover)] border border-[var(--color-border)]",
          className,
        )}
      >
        {/* Selection toggle */}
        <button
          onClick={isAllSelected ? onClearSelection : onSelectAll}
          aria-label={isAllSelected ? `Deselect all ${itemLabel}` : `Select all ${itemLabel}`}
          aria-pressed={isAllSelected}
          className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] transition-colors"
          title={isAllSelected ? "Deselect all" : "Select all"}
        >
          {isAllSelected ? (
            <CheckSquare className="h-5 w-5 text-accent-primary" />
          ) : isPartiallySelected ? (
            <div className="relative">
              <Square className="h-5 w-5 text-[var(--color-muted-foreground)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2.5 h-0.5 bg-accent-primary rounded-full" />
              </div>
            </div>
          ) : (
            <Square className="h-5 w-5 text-[var(--color-muted-foreground)]" />
          )}
        </button>

        {/* Selection count */}
        <div className="flex items-center gap-2 border-r border-[var(--color-border)] pr-3">
          <span className="text-sm font-medium text-[var(--color-foreground)]">
            {selectedCount}
          </span>
          <span className="text-sm text-[var(--color-muted-foreground)]">
            of {totalCount} {itemLabel} selected
          </span>
        </div>

        {/* Main actions */}
        <div className="flex items-center gap-1">
          {mainActions.map((action) => (
            <Button
              key={action.id}
              variant={action.variant === "destructive" ? "destructive" : "ghost"}
              size="sm"
              onClick={() => handleAction(action)}
              disabled={loadingAction !== null}
              className={cn(
                "h-8 px-3 gap-2",
                action.variant === "destructive" &&
                  "text-[var(--color-error)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10",
              )}
            >
              {action.icon}
              <span className="hidden sm:inline">{action.label}</span>
            </Button>
          ))}

          {/* More actions dropdown */}
          {menuActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {menuActions.map((action, index) => (
                  <React.Fragment key={action.id}>
                    {index > 0 && action.variant === "destructive" && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onClick={() => handleAction(action)}
                      disabled={loadingAction !== null}
                      className={cn(
                        action.variant === "destructive" && "text-[var(--color-error)]",
                      )}
                    >
                      {action.icon}
                      <span className="ml-2">{action.label}</span>
                    </DropdownMenuItem>
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Clear selection button */}
        <button
          onClick={onClearSelection}
          aria-label="Clear selection"
          className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] transition-colors ml-1"
          title="Clear selection"
        >
          <X className="h-4 w-4 text-[var(--color-muted-foreground)]" aria-hidden="true" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Default bulk actions that can be used across different views
 */
export function getDefaultBulkActions(options: {
  onDelete?: (ids: string[]) => Promise<void>;
  onExport?: (ids: string[]) => void;
  onStatusChange?: (ids: string[], status: string) => Promise<void>;
  statuses?: { value: string; label: string }[];
}): BulkAction[] {
  const actions: BulkAction[] = [];

  if (options.onExport) {
    actions.push({
      id: "export",
      label: "Export",
      icon: <Download className="h-4 w-4" />,
      onClick: options.onExport,
    });
  }

  if (options.onDelete) {
    actions.push({
      id: "delete",
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      variant: "destructive",
      onClick: options.onDelete,
      inMenu: true, // Show in dropdown for safety
    });
  }

  return actions;
}
