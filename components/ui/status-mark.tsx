import type { ReactNode } from "react";

import { cn } from "@/lib/utils/utils";

/**
 * The one way a state is drawn: a dot in the state's colour and its name in plain small type.
 *
 * Status was a solid `Badge`, an outlined mono `Badge`, a soft-washed pill built by hand in seven
 * places, a coloured word, and a bare dot; the same lease was grey in one list and red on its own
 * page. The colour lives in the dot, so the words stay the foreground colour and clear contrast on
 * any surface, where a tinted word on a tinted pill had to be tuned against each one.
 *
 * Which tone a stored value takes is decided once, in `lib/utils/status-tone.ts`, never per screen.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const DOT: Record<StatusTone, string> = {
  success: "bg-[var(--semantic-success-readable)]",
  warning: "bg-[var(--semantic-warning-readable)]",
  danger: "bg-[var(--semantic-danger-readable)]",
  info: "bg-[var(--semantic-info-readable)]",
  neutral: "bg-[var(--color-muted-foreground)]",
};

export function StatusMark({
  tone,
  struck = false,
  className,
  children,
}: {
  tone: StatusTone;
  /** A state that no longer counts (a voided receipt, a duplicate movement). */
  struck?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium",
        struck
          ? "text-[var(--color-muted-foreground)] line-through"
          : "text-[var(--color-foreground)]",
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      {/* Its own box, because ::first-letter does not apply to a flex container. Labels written
          for the old capitals ("faltam 51d") start with a capital without a catalogue sweep. */}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </span>
  );
}
