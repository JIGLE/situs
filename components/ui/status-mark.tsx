import type { ReactNode } from "react";

import { cn } from "@/lib/utils/utils";

/**
 * The one way a state is drawn: a small pill tinted in the state's colour, its name in that
 * colour's readable shade (design study D4).
 *
 * Status was a solid `Badge`, an outlined mono `Badge`, a soft-washed pill built by hand in seven
 * places, a coloured word, and a bare dot; the same lease was grey in one list and red on its own
 * page. It became a dot and a plain word, which was consistent but left a screen of late
 * tenants reading as a column of red amounts. The pill carries the state, so amounts beside it
 * stay in the text colour. The `*-readable` shades are measured against this very wash
 * (`readableOnChip` in `lib/design/country-themes.ts`), so the words clear 4.5:1 on it.
 *
 * Which tone a stored value takes is decided once, in `lib/utils/status-tone.ts`, never per screen.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const PILL: Record<StatusTone, string> = {
  success: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  warning: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  danger: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  info: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  neutral: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
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
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        struck
          ? "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] line-through"
          : PILL[tone],
        className,
      )}
    >
      {/* Its own box, because ::first-letter does not apply to a flex container. Labels written
          for the old capitals ("faltam 51d") start with a capital without a catalogue sweep. */}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </span>
  );
}
