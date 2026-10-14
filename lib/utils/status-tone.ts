import type { StatusTone } from "@/components/ui/status-mark";

/**
 * Which tone each stored state takes, once, for every screen.
 *
 * A lease that was grey in the list and red on its own page, a property that was solid on one
 * screen and outlined on another: each screen had its own switch. A value this file does not know
 * is neutral, so a state added to the schema shows as a plain mark until it is given a tone here.
 */
export interface StatusKind {
  tone: StatusTone;
  /** The state no longer counts. */
  struck?: boolean;
}

const NEUTRAL: StatusKind = { tone: "neutral" };
const pick = (table: Record<string, StatusKind>, status: string | null | undefined): StatusKind =>
  (status ? table[status] : undefined) ?? NEUTRAL;

const LEASE: Record<string, StatusKind> = {
  active: { tone: "success" },
  pending: { tone: "info" },
  expired: { tone: "danger" },
  terminated: { tone: "neutral" },
};

/** A tenant's rent standing, and a receipt's money state (paid | pending). */
const PAYMENT: Record<string, StatusKind> = {
  paid: { tone: "success" },
  pending: { tone: "warning" },
  overdue: { tone: "danger" },
};

const PROPERTY: Record<string, StatusKind> = {
  occupied: { tone: "success" },
  vacant: { tone: "neutral" },
  maintenance: { tone: "warning" },
};

/** A receipt's document stage. */
const RECEIPT_STAGE: Record<string, StatusKind> = {
  draft: { tone: "warning" },
  review: { tone: "warning" },
  rejected: { tone: "danger" },
  submitted: { tone: "info" },
  accepted: { tone: "success" },
  emitted: { tone: "success" },
  voided: { tone: "neutral", struck: true },
};

/** A bank movement in the inbox. */
const MOVEMENT: Record<string, StatusKind> = {
  auto_matched: { tone: "success" },
  matched_confirmed: { tone: "success" },
  needs_review: { tone: "warning" },
  imported: { tone: "info" },
  ignored: { tone: "neutral" },
  duplicate: { tone: "neutral", struck: true },
};

/** A live bank connection. Revoked is a state chosen on purpose, not a fault. */
const CONNECTION: Record<string, StatusKind> = {
  active: { tone: "success" },
  pending_consent: { tone: "warning" },
  expired: { tone: "danger" },
  revoked: { tone: "neutral" },
  error: { tone: "danger" },
};

/** A check on the system status page. */
const SEVERITY: Record<string, StatusKind> = {
  ok: { tone: "success" },
  simulated: { tone: "info" },
  warning: { tone: "warning" },
  error: { tone: "danger" },
};

export const leaseStatus = (status: string | null | undefined) => pick(LEASE, status);
export const paymentStatus = (status: string | null | undefined) => pick(PAYMENT, status);
export const propertyStatus = (status: string | null | undefined) => pick(PROPERTY, status);
export const receiptStage = (stage: string | null | undefined) => pick(RECEIPT_STAGE, stage);
export const movementStatus = (status: string | null | undefined) => pick(MOVEMENT, status);
export const connectionStatus = (status: string | null | undefined) => pick(CONNECTION, status);
export const severityStatus = (severity: string | null | undefined) => pick(SEVERITY, severity);

/** How near a lease's end is: inside 30 days is urgent, inside 60 a warning, past that fine. */
export const leaseEndStatus = (daysLeft: number): StatusKind => ({
  tone: daysLeft <= 30 ? "danger" : daysLeft <= 60 ? "warning" : "success",
});
