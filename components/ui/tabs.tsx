"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("flex items-center gap-1 border-b border-[var(--color-border)]", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap border border-b-0 border-transparent px-3 py-2 font-mono text-[12px] md:text-[10px] uppercase tracking-[0.06em] text-[var(--color-muted-foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--country-highlight-readable)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)] disabled:pointer-events-none disabled:opacity-50 hover:text-[var(--color-foreground)] data-[state=active]:border-[var(--color-border)] data-[state=active]:border-t-2 data-[state=active]:border-t-[var(--country-highlight-readable)] data-[state=active]:bg-[var(--color-hover)] data-[state=active]:text-[var(--color-foreground)] max-md:min-h-11",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--country-highlight-readable)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export interface TabsMobileSelectItem {
  value: string;
  label: string;
  badge?: React.ReactNode;
}

interface TabsMobileSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  items: TabsMobileSelectItem[];
  className?: string;
  "aria-label"?: string;
}

/**
 * Doctrine rule 4 fallback for tab bars past ~4 items: a native `<select>` driving the
 * same controlled value as the adjacent `Tabs`/`TabsList`. Purely additive — pair it with
 * `<TabsList className="hidden md:flex">` so the bar itself only shows at `md` and up;
 * this component doesn't toggle its own visibility so callers can choose the breakpoint.
 */
const TabsMobileSelect = ({
  value,
  onValueChange,
  items,
  className,
  "aria-label": ariaLabel = "Select tab",
}: TabsMobileSelectProps): React.ReactElement => (
  <select
    value={value}
    onChange={(e) => onValueChange(e.target.value)}
    aria-label={ariaLabel}
    className={cn(
      "h-11 w-full border border-[var(--color-border)] bg-[var(--color-card-solid)] px-3",
      "font-mono text-xs uppercase tracking-[0.06em] text-[var(--color-foreground)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--country-highlight-readable)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]",
      className,
    )}
  >
    {items.map((item) => (
      <option key={item.value} value={item.value}>
        {item.badge ? `${item.label} (${item.badge})` : item.label}
      </option>
    ))}
  </select>
);
TabsMobileSelect.displayName = "TabsMobileSelect";

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsMobileSelect };
