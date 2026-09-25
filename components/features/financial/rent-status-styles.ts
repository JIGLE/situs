import { AlertCircle, Check, CircleDashed, Clock, Minus, type LucideIcon } from "lucide-react";

/**
 * How a rent month's status looks, shared by the matrix and the month sheet. Paid and paid late
 * look the same: the matrix answers who has paid, and with every month due on the 1st at
 * midnight, "late" would mark almost every payment. The sheet still says which it was.
 */
export const CELL_STYLES: Record<string, string> = {
  paid: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  paid_late: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  partially_paid: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  overdue: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  due: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  upcoming: "text-[var(--color-muted-foreground)]",
  waived: "text-[var(--color-muted-foreground)]",
};

/** The icon beside the colour, so a status never rests on colour alone. */
export const CELL_ICONS: Record<string, LucideIcon> = {
  paid: Check,
  paid_late: Check,
  partially_paid: CircleDashed,
  overdue: AlertCircle,
  due: Clock,
  waived: Minus,
};

/** The statuses the legend explains, in the order a month moves through them. */
export const LEGEND_STATUSES = ["paid", "partially_paid", "overdue", "due", "upcoming"] as const;
