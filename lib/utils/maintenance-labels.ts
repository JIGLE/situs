/**
 * Catalogue keys for a maintenance ticket's stored status and priority, under the `maintenance`
 * namespace.
 *
 * Extracted from `maintenance-view.tsx`, which held the status map privately while the property
 * detail view rendered both enums raw — a ticket list reading "in_progress" and "urgent" beside
 * a Maintenance screen that says "Em Curso" and "Urgente" for the same records. The status keys
 * exist because the stored values are snake_case and the catalogue is camelCase; the priority
 * keys happen to match their values today, and are spelled out anyway so a renamed key is a
 * compile error rather than a word that silently renders as itself.
 */
export const TICKET_STATUS_KEY = {
  open: "statusOpen",
  in_progress: "statusInProgress",
  resolved: "statusResolved",
  closed: "statusClosed",
} as const;

export const TICKET_PRIORITY_KEY = {
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
} as const;

export type TicketStatus = keyof typeof TICKET_STATUS_KEY;
export type TicketPriority = keyof typeof TICKET_PRIORITY_KEY;
