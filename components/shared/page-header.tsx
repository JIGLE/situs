import { ReactNode } from "react";

import { cn } from "@/lib/utils/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** The page's actions (export, create, save), on the right from `md` up and under the title below it. */
  children?: ReactNode;
  /** For a title that is not the name of the screen, such as the dashboard's greeting. */
  titleOnMobile?: boolean;
  /** Names the heading for a region that points at it with `aria-labelledby`. */
  id?: string;
  /** A hook for tests that read the heading by something other than its role. */
  titleTestId?: string;
  className?: string;
}

/**
 * The one page header: the page's `h1`, an optional line under it, and its actions.
 *
 * Seven main screens each drew their own: `text-2xl bold`, `text-3xl bold`, `semibold`, a light
 * greeting, with or without an icon, with the subtitle hidden or not on a phone. A screen has one
 * heading (`CLAUDE.md`, Screen density), so this is the only place a page's `h1` is written.
 *
 * Below `md` the top bar already names the screen, so the title and the line under it stay for a
 * screen reader and the visible header shrinks to the actions. A title that says something the top
 * bar does not (`titleOnMobile`) stays.
 */
export function PageHeader({
  title,
  description,
  children,
  titleOnMobile = false,
  id,
  titleTestId,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}
    >
      <div className={cn("min-w-0", !titleOnMobile && "max-md:sr-only")}>
        <h1
          id={id}
          data-testid={titleTestId}
          className="min-h-[1.25em] text-[clamp(22px,3vw,28px)] font-normal leading-tight tracking-[-0.03em] text-[var(--color-foreground)]"
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{description}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
