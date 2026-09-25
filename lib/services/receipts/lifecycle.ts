/**
 * Situs receipt lifecycle — pure state machine for the DOCUMENT state of a
 * Receipt (`Receipt.lifecycle`). Distinct from `Receipt.status`, which is the
 * MONEY state (paid|pending) and is untouched by this module.
 *
 *   draft → review → emitted → submitted → accepted | rejected
 *   draft/review/emitted → voided
 *   rejected → review (fix and resubmit)
 *
 * Archive is a SIDE EFFECT of reaching emitted/accepted, not a state of its
 * own — the service layer generates the PDF and files it as a Document when
 * the transition lands here. No IO, no Prisma here.
 */

export type ReceiptLifecycleState =
  "draft" | "review" | "emitted" | "submitted" | "accepted" | "rejected" | "voided";

const TRANSITIONS: Record<ReceiptLifecycleState, ReceiptLifecycleState[]> = {
  draft: ["review", "emitted", "voided"],
  review: ["draft", "emitted", "voided"],
  emitted: ["submitted", "voided"],
  submitted: ["accepted", "rejected"],
  accepted: [],
  rejected: ["review"],
  voided: [],
};

/** States that trigger the archive side effect (PDF → Document) on entry. */
export const ARCHIVE_ON_STATES: ReadonlySet<ReceiptLifecycleState> = new Set([
  "emitted",
  "accepted",
]);

/** Terminal states — the lifecycle never leaves these via this state machine. */
export const TERMINAL_STATES: ReadonlySet<ReceiptLifecycleState> = new Set(["accepted", "voided"]);

/**
 * States in which the receipt has gone to Finanças. Situs keeps these as the record of that
 * submission: deleting one here would not void it at AT, which only the Portal can do.
 */
export const FILED_STATES: ReadonlySet<ReceiptLifecycleState> = new Set(["submitted", "accepted"]);

export function isFiled(lifecycle: string | null | undefined): boolean {
  return FILED_STATES.has(lifecycle as ReceiptLifecycleState);
}

export function isValidState(value: string): value is ReceiptLifecycleState {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, value);
}

export function canTransition(from: ReceiptLifecycleState, to: ReceiptLifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
  archiveTriggered: boolean;
}

/**
 * Validate a requested transition. Does not apply it — the service layer
 * commits the state change plus any side effects (archive, audit, PT
 * connector submit) after checking `allowed`.
 */
export function evaluateTransition(from: string, to: ReceiptLifecycleState): TransitionResult {
  if (!isValidState(from)) {
    return { allowed: false, reason: `Unknown current state "${from}"`, archiveTriggered: false };
  }
  if (!canTransition(from, to)) {
    return {
      allowed: false,
      reason: `Cannot move from "${from}" to "${to}"`,
      archiveTriggered: false,
    };
  }
  return { allowed: true, archiveTriggered: ARCHIVE_ON_STATES.has(to) };
}

/** The set of states a receipt in `from` may legally move to next. */
export function nextStates(from: ReceiptLifecycleState): ReceiptLifecycleState[] {
  return TRANSITIONS[from];
}
