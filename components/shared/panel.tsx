import type { ReactNode } from "react";

import { cn } from "@/lib/utils/utils";

/**
 * The one panel: a heading above a box that holds the description and the body.
 *
 * Settings drew its panels as `Card`s with a large title and an icon, the Access screens as hand-
 * built sections with a medium title, the control center as ruled tiles with a small capitalised
 * title, and the danger and warning boxes each with their own border. A screen's panels are
 * `h2`s under its `PageHeader` `h1`; this is the only place one is written.
 *
 * The title sits above the box, not inside it (design study D2): inside, as a small line over a
 * rule, it read as a caption and the eye landed on the first row instead. The box is drawn with a
 * hairline and a faint shadow rather than a full-strength border (D1).
 *
 * `tone` is the one semantic edge: a `warning` or `danger` panel says so with its border, not
 * with a different shape.
 *
 * The body scrolls only when something bounds the panel's height (`min-h-0` is what lets a flex
 * child shrink below its content inside a grid track). Nothing does since Admin moved into the
 * app's shell, whose page scrolls, so each panel is as tall as its content.
 */
const TONES = {
  default: "border-[var(--color-hairline)] shadow-[var(--shadow-panel)]",
  warning: "border-[var(--semantic-warning-readable)]",
  danger: "border-[var(--semantic-danger)]",
} as const;

/** A block's heading, above its box: the panel's, and Home's lists, which draw their own box. */
export function BlockHeading({
  title,
  action,
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <header className="flex min-h-8 flex-none items-center justify-between gap-2 px-0.5">
      <h2 id={id} className="truncate text-reading font-semibold text-[var(--color-foreground)]">
        {title}
      </h2>
      {action}
    </header>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  tone = "default",
  padded = false,
  className,
  bodyClassName,
}: {
  /** Left out when something already names the panel, such as the tab it sits under. */
  title?: string;
  /** What the panel is for, in a line at the top of the box. */
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  tone?: keyof typeof TONES;
  /** The body's own padding and rhythm, for a panel that holds a form or a list of lines. */
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  const boxed = description !== undefined || children !== undefined;
  return (
    <section className={cn("flex flex-col gap-2", "lg:min-h-0", className)}>
      {(title || action) && <BlockHeading title={title} action={action} />}
      {boxed && (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden border bg-[var(--color-surface-solid)]",
            TONES[tone],
          )}
        >
          {description && (
            <p className="px-4 pt-3 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
              {description}
            </p>
          )}
          {children !== undefined && (
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto",
                padded && "space-y-4 p-4",
                bodyClassName,
              )}
            >
              {children}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A label/value line. Used wherever a panel states a fact rather than listing records.
 *
 * A value is one line that ends in an ellipsis, which suits a name or a number. A value that is
 * words, such as a sentence, is cut off in the longer languages with nothing to reach the rest, so
 * those pass `wrap` and run onto a second line instead.
 */
export function Fact({
  label,
  value,
  tone = "normal",
  wrap = false,
}: {
  label: string;
  value: ReactNode;
  tone?: "normal" | "muted";
  wrap?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-sm",
          wrap ? "break-words" : "truncate",
          tone === "muted"
            ? "text-[var(--color-muted-foreground)]"
            : "text-[var(--color-foreground)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
