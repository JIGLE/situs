import {
  Banknote,
  Bell,
  CalendarClock,
  CircleAlert,
  FileText,
  type LucideIcon,
} from "lucide-react";

/**
 * Mirrors the Prisma `NotificationType` enum (`prisma/schema.prisma`). Hand-kept rather than
 * imported from `@prisma/client` — this file is reachable from client components, and nothing
 * else in the tree pulls the generated Prisma client across that boundary.
 */
export type NotificationType =
  | "payment_due"
  | "payment_overdue"
  | "rent_receipt_due"
  | "lease_renewal_reminder"
  | "system"
  | "other";

/**
 * Catalogue key for a notification's stored `type`, under `notifications.*`. Extracted rather
 * than copied for the same reason as RECEIPT_TYPE_KEY: one place to render the enum means one
 * place that can go stale when a value is added, instead of every reader re-deriving its own
 * label (or, worse, printing the raw snake_case value).
 */
export const NOTIFICATION_TYPE_KEY = {
  payment_due: "paymentDue",
  payment_overdue: "paymentOverdue",
  rent_receipt_due: "rentReceiptDue",
  lease_renewal_reminder: "leaseRenewalReminder",
  system: "system",
  other: "other",
} as const satisfies Record<NotificationType, string>;

/** Icon shown next to a notification of this type in the bell and anywhere else it is listed. */
export const NOTIFICATION_TYPE_ICON: Record<NotificationType, LucideIcon> = {
  payment_due: Banknote,
  payment_overdue: CircleAlert,
  rent_receipt_due: FileText,
  lease_renewal_reminder: CalendarClock,
  system: Bell,
  other: Bell,
};
