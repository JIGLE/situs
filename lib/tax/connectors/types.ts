/**
 * Situs tax connector contract. Every country connector wraps the existing
 * fiscal logic for that jurisdiction — this interface does not replace
 * lib/compliance/rent-receipts-pt.ts, it orchestrates it and
 * appends the TaxSubmissionLog trail (Migration C).
 *
 * `mode` on the underlying TaxAuthorityConnector row governs behavior:
 * sandbox/review never call a live tax-authority endpoint (none exists yet
 * — see plan risk register); "live" is reserved for a future real
 * integration and is intentionally unimplemented today.
 */

export interface TaxConnectorResult {
  status: "success" | "error" | "pending";
  responseCode?: string;
  responseBody?: string;
}

export interface TaxConnector {
  key: string;
  country: string;
  /** Pre-submission validation — does not mutate state. */
  validate(subjectId: string): Promise<{ valid: boolean; errors: string[] }>;
  /** Send the subject to the authority (or simulate doing so in sandbox/review). */
  submit(subjectId: string): Promise<TaxConnectorResult>;
  /** Check on a previously submitted subject's outcome. */
  poll(subjectId: string): Promise<TaxConnectorResult>;
}
