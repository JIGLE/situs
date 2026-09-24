"use client";

import * as React from "react";
import { cn } from "@/lib/utils/utils";

/**
 * Skip Link - Allows keyboard users to skip to main content
 * Should be the first focusable element on the page
 */
interface SkipLinkProps {
  href?: string;
  /** The caller's translated copy. No default: an English fallback is how the layouts shipped one. */
  children: React.ReactNode;
  className?: string;
}

export function SkipLink({ href = "#main-content", children, className }: SkipLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)]",
        "focus:px-4 focus:py-2 focus:bg-[var(--color-card)] focus:text-[var(--color-foreground)]",
        "focus:rounded-lg focus:border focus:border-[var(--color-border)]",
        "focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-[var(--color-background)]",
        "focus:outline-none focus:shadow-lg",
        "transition-all duration-200",
        "font-medium text-sm",
        className,
      )}
    >
      {children}
    </a>
  );
}
