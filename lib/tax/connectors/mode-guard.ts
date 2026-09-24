import { logSubmission } from "@/lib/services/tax/connector-service";
import { SIMULATED_MODES } from "./modes";
import type { TaxConnectorResult } from "./types";

/**
 * The only modes a connector may act in.
 *
 * No country has a live tax-authority integration. Every connector simulates the round trip,
 * so simulating is opt-in per mode and everything else fails closed.
 *
 * WHY THIS IS SHARED RATHER THAN PER-CONNECTOR. The Portugal connector shipped without this
 * check: `submit()` and `poll()` ran their simulation regardless of `connector.mode`, so
 * flipping the `mode` column to "live" — an unconstrained String, and the first thing an
 * operator going live would try — made Situs mark rent receipts submitted and then accepted by
 * the Autoridade Tributária with nothing sent. A landlord would believe they had filed.
 *
 * A fabricated acceptance on a fiscal record is worse than a visible failure. Re-implementing
 * that judgement in each new country connector is how it comes back, so it lives here and
 * every connector calls it. Adding a real integration means widening SIMULATED_MODES
 * deliberately — not editing a database row.
 */
// Defined in ./modes so the client-side presentation helper can read it without importing
// this file, which reaches Prisma. Re-exported here so existing importers are unaffected.
export { SIMULATED_MODES } from "./modes";

export interface ModeGuardInput {
  connector: { id: string; mode: string };
  userId: string;
  /** Matches TaxSubmissionLog.subjectType — a rent receipt for PT, an NRUA registration for ES. */
  subjectType: "rent_receipt" | "modelo179" | "nrua";
  subjectId: string;
  action: "submit" | "poll";
  /** Human name of the authority, for the message the operator will read. */
  authority: string;
}

/**
 * Returns a refusal result when the connector's mode cannot be honoured, or `null` when the
 * caller may proceed.
 *
 * Call this BEFORE any state change — the point is that nothing is marked submitted or
 * accepted, not that it is corrected afterwards.
 *
 * The refusal is logged rather than returned silently: an operator who set the mode needs to
 * be able to discover why nothing is being submitted, and TaxSubmissionLog is where they will
 * look. A gate that fails quietly is only half a gate.
 */
export async function refuseUnsupportedMode(
  input: ModeGuardInput,
): Promise<TaxConnectorResult | null> {
  const { connector, userId, subjectType, subjectId, action, authority } = input;

  if (SIMULATED_MODES.has(connector.mode)) return null;

  const responseBody =
    `Connector mode "${connector.mode}" is not supported: there is no live ${authority} ` +
    `integration. Nothing was submitted. Set the connector back to "sandbox" or "review".`;

  await logSubmission({
    userId,
    connectorId: connector.id,
    subjectType,
    subjectId,
    action,
    mode: connector.mode,
    status: "error",
    responseBody,
  });

  return { status: "error", responseBody };
}
