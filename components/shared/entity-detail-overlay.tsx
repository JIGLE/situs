"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useEntityDetailClose } from "@/lib/hooks/use-entity-detail-close";

interface EntityDetailOverlayProps {
  /** Screen-reader-only heading — the overlay has no visible chrome of its own. */
  title: string;
  description: string;
  /** Locale-prefixed full-page route, e.g. `/en/portfolio/abc123`. Omit for entities with no full-page destination (owner, document). */
  fullPageHref?: string;
  children: React.ReactNode;
}

/**
 * Shared center-Sheet chrome for the `?detail=<type>:<id>` entity overlay
 * convention — generalizes the pattern Property's `?modal=` sheet already
 * used. Per-entity route-client wrappers resolve the id and mount their
 * content inside this; closing preserves every other search param on the
 * current page (e.g. `/people?view=owners`) and falls back to the current
 * pathname (minus `detail`) when there's no history to go back to.
 */
export function EntityDetailOverlay({
  title,
  description,
  fullPageHref,
  children,
}: EntityDetailOverlayProps) {
  const t = useTranslations("entityOverlay");
  const handleClose = useEntityDetailClose();

  return (
    <Sheet open onOpenChange={(open) => !open && handleClose()}>
      <SheetContent side="center" className="p-0">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        {/* Capped as the sheet is: under `md:h-auto` the sheet's own ceiling does not reach a
            child's `h-full`, so a long detail ran past the frame instead of scrolling inside it. */}
        <div className="flex h-full flex-col md:max-h-[calc(100dvh-6.5rem)]">
          {fullPageHref && (
            <div className="flex justify-start px-6 pt-4">
              <Link
                href={fullPageHref}
                className="flex min-h-6 items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:underline max-md:min-h-11"
              >
                {t("openFullPage")} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl p-6 h-full">{children}</div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
