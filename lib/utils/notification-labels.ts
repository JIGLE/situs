import {
  Banknote,
  Bell,
  CalendarClock,
  CircleAlert,
  FileText,
  Inbox,
  UserSquare2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Mirrors the Prisma `NotificationType` enum (`prisma/schema.prisma`). Hand-kept rather than
 * imported from `@prisma/client` — this file is reachable from client components, and nothing
 * else in the tree pulls the generated Prisma client across that boundary.
 */
export type NotificationType =
  | "lease_expiring"
  | "payment_due"
  | "payment_received"
  | "payment_overdue"
  | "maintenance_created"
  | "maintenance_completed"
  | "document_uploaded"
  | "rent_receipt_due"
  | "nrua_registration"
  | "lease_renewal_reminder"
  | "inbound_message"
  | "system"
  | "other";

/**
 * Catalogue key for a notification's stored `type`, under `notifications.*`. Extracted rather
 * than copied for the same reason as RECEIPT_TYPE_KEY: one place to render the enum means one
 * place that can go stale when a value is added, instead of every reader re-deriving its own
 * label (or, worse, printing the raw snake_case value).
 */
export const NOTIFICATION_TYPE_KEY: Record<NotificationType, string> = {
  lease_expiring: "leaseExpiring",
  payment_due: "paymentDue",
  payment_received: "paymentReceived",
  payment_overdue: "paymentOverdue",
  maintenance_created: "maintenanceCreated",
  maintenance_completed: "maintenanceCompleted",
  document_uploaded: "documentUploaded",
  rent_receipt_due: "rentReceiptDue",
  nrua_registration: "nruaRegistration",
  lease_renewal_reminder: "leaseRenewalReminder",
  inbound_message: "inboundMessage",
  system: "system",
  other: "other",
};

/** Icon shown next to a notification of this type in the bell and anywhere else it is listed. */
export const NOTIFICATION_TYPE_ICON: Record<NotificationType, LucideIcon> = {
  lease_expiring: CalendarClock,
  payment_due: Banknote,
  payment_received: Banknote,
  payment_overdue: CircleAlert,
  maintenance_created: Wrench,
  maintenance_completed: Wrench,
  document_uploaded: FileText,
  rent_receipt_due: FileText,
  nrua_registration: UserSquare2,
  lease_renewal_reminder: CalendarClock,
  inbound_message: Inbox,
  system: Bell,
  other: Bell,
};
