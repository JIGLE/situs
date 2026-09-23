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

/**
 * Skip Links Group - Multiple skip links for complex layouts
 */
interface SkipLinksProps {
  links?: Array<{ href: string; label: string }>;
  className?: string;
}

export function SkipLinks({
  links = [
    { href: "#main-content", label: "Skip to main content" },
    { href: "#main-navigation", label: "Skip to navigation" },
  ],
  className,
}: SkipLinksProps) {
  return (
    <div className={cn("skip-links", className)}>
      {links.map((link) => (
        <SkipLink key={link.href} href={link.href}>
          {link.label}
        </SkipLink>
      ))}
    </div>
  );
}

/**
 * Visually Hidden - Content visible only to screen readers
 */
interface VisuallyHiddenProps {
  children: React.ReactNode;
  as?: React.ElementType;
}

export function VisuallyHidden({ children, as: Component = "span" }: VisuallyHiddenProps) {
  return <Component className="sr-only">{children}</Component>;
}

/**
 * Announce - Live region for screen reader announcements
 */
interface AnnounceProps {
  children: React.ReactNode;
  role?: "status" | "alert" | "log";
  "aria-live"?: "polite" | "assertive" | "off";
  "aria-atomic"?: boolean;
  className?: string;
}

export function Announce({
  children,
  role = "status",
  "aria-live": ariaLive = "polite",
  "aria-atomic": ariaAtomic = true,
  className,
}: AnnounceProps) {
  return (
    <div
      role={role}
      aria-live={ariaLive}
      aria-atomic={ariaAtomic}
      className={cn("sr-only", className)}
    >
      {children}
    </div>
  );
}

/**
 * Hook for announcing messages to screen readers
 */
export function useAnnounce() {
  const [message, setMessage] = React.useState("");
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const announce = React.useCallback((text: string, clearAfter = 1000) => {
    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set message (this triggers the announcement)
    setMessage(text);

    // Clear after delay to allow repeated announcements
    timeoutRef.current = setTimeout(() => {
      setMessage("");
    }, clearAfter);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { message, announce };
}

/**
 * Focus Trap - Traps focus within a container (useful for modals)
 */
interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}

export function FocusTrap({ children, active = true, className }: FocusTrapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    firstElement?.focus();

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}

/**
 * Landmark component wrappers for semantic HTML
 */
interface LandmarkProps {
  children: React.ReactNode;
  label?: string;
  className?: string;
}

export function Main({ children, label = "Main content", className }: LandmarkProps) {
  return (
    <main
      id="main-content"
      aria-label={label}
      tabIndex={-1}
      className={cn("focus:outline-none", className)}
    >
      {children}
    </main>
  );
}

export function Navigation({ children, label = "Main navigation", className }: LandmarkProps) {
  return (
    <nav id="main-navigation" aria-label={label} className={className}>
      {children}
    </nav>
  );
}

export function Aside({ children, label = "Sidebar", className }: LandmarkProps) {
  return (
    <aside aria-label={label} className={className}>
      {children}
    </aside>
  );
}

export function Region({ children, label, className }: LandmarkProps) {
  return (
    <section aria-label={label} className={className}>
      {children}
    </section>
  );
}

/**
 * Loading announcement for async operations
 */
interface LoadingAnnouncerProps {
  isLoading: boolean;
  loadingMessage?: string;
  loadedMessage?: string;
}

export function LoadingAnnouncer({
  isLoading,
  loadingMessage = "Loading...",
  loadedMessage = "Content loaded",
}: LoadingAnnouncerProps) {
  const prevLoading = React.useRef(isLoading);

  const getMessage = () => {
    if (isLoading && !prevLoading.current) {
      return loadingMessage;
    }
    if (!isLoading && prevLoading.current) {
      return loadedMessage;
    }
    return "";
  };

  React.useEffect(() => {
    prevLoading.current = isLoading;
  }, [isLoading]);

  return <Announce aria-live="polite">{getMessage()}</Announce>;
}
