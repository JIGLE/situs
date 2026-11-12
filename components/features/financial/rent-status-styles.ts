import {
  AlertCircle,
  Check,
  CircleDashed,
  Clock,
  FileCheck2,
  Minus,
  type LucideIcon,
} from "lucide-react";

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

/**
 * A paid month whose every payment has its recibo from Finanças on file: the paid green, deeper,
 * with a document tick. Two tones of one colour: payment recorded, and recibo on file too.
 */
export const RECIBO_STYLE =
  "bg-[var(--semantic-success-strong)] text-[var(--semantic-success-readable)] font-medium";
export const RECIBO_ICON: LucideIcon = FileCheck2;

const PAID = new Set(["paid", "paid_late"]);

/** The style and icon of a month, with the recibo's deeper tone when it is paid and on file. */
export function cellLook(
  status: string,
  receiptOnFile: boolean,
): { style: string; icon: LucideIcon | undefined } {
  if (receiptOnFile && PAID.has(status)) return { style: RECIBO_STYLE, icon: RECIBO_ICON };
  return { style: CELL_STYLES[status] ?? "", icon: CELL_ICONS[status] };
}
