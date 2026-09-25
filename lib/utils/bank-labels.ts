import type { MatchReason } from "@/lib/services/matching/engine";

/**
 * Labels for what the bank pipeline stores. A stored enum is not a label: the inbox used to show
 * status codes (AUTO, CONF, REVIEW) and the match signals with their underscores turned into
 * spaces ("iban match", "negative amount"), English on a Portuguese screen.
 *
 * Keys are relative to `financial.bank`.
 */

/** `BankTransaction.status` → its label. */
export const BANK_STATUS_KEY = {
  needs_review: "status.needsReview",
  auto_matched: "status.autoMatched",
  matched_confirmed: "status.confirmed",
  ignored: "status.ignored",
  imported: "status.imported",
  duplicate: "status.duplicate",
} as const;

export type BankStatusKey = (typeof BANK_STATUS_KEY)[keyof typeof BANK_STATUS_KEY];

/** The label key for a stored status, or null for one no code writes any more. */
export function bankStatusKey(status: string): BankStatusKey | null {
  return Object.hasOwn(BANK_STATUS_KEY, status)
    ? BANK_STATUS_KEY[status as keyof typeof BANK_STATUS_KEY]
    : null;
}

/** The matching engine's reasons (`MatchReason`), then the warnings the import adds. */
const SIGNAL_KEY = {
  iban_match: "signals.ibanMatch",
  name_match: "signals.nameMatch",
  amount_exact: "signals.amountExact",
  amount_multiple: "signals.amountMultiple",
  amount_remainder: "signals.amountRemainder",
  reference_hit: "signals.referenceHit",
  possible_duplicate: "signals.possibleDuplicate",
  negative_amount: "signals.negativeAmount",
  ambiguous_candidates: "signals.ambiguousCandidates",
  test_connection_not_allocated: "signals.testConnectionNotAllocated",
} as const satisfies Record<MatchReason, string> & Record<string, string>;

/** Every warning `importBankRows` writes without a parameter. A test holds this to its source. */
export const IMPORT_WARNING_CODES = [
  "possible_duplicate",
  "negative_amount",
  "ambiguous_candidates",
  "test_connection_not_allocated",
] as const;

type SignalKey = (typeof SIGNAL_KEY)[keyof typeof SIGNAL_KEY];

/** One signal, ready for `t(key, values)`. */
export type MatchSignal =
  | { key: SignalKey }
  | { key: "signals.rule"; values: { name: string } }
  | { key: "signals.referenceConflict"; values: { reference: string; expected: string } };

function signal(code: string): MatchSignal | null {
  if (code.startsWith("rule:")) {
    return { key: "signals.rule", values: { name: code.slice("rule:".length) } };
  }
  // `reference_conflict:2026-07≠2026-06`: the month the reference names, then the oldest unpaid.
  const conflict = /^reference_conflict:(\d{4}-\d{2})≠(\d{4}-\d{2})$/.exec(code);
  if (conflict) {
    return {
      key: "signals.referenceConflict",
      values: { reference: conflict[1], expected: conflict[2] },
    };
  }
  return Object.hasOwn(SIGNAL_KEY, code)
    ? { key: SIGNAL_KEY[code as keyof typeof SIGNAL_KEY] }
    : null;
}

/**
 * The signals stored in `BankTransaction.matchReasons` (`{ reasons, warnings }`), reasons first.
 * A code nothing here knows is left out rather than shown raw.
 */
export function matchSignals(raw: string | null): MatchSignal[] {
  if (!raw) return [];
  let parsed: { reasons?: unknown; warnings?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return [];
  }
  const codes = [parsed.reasons, parsed.warnings].flatMap((list) =>
    Array.isArray(list) ? list.filter((code): code is string => typeof code === "string") : [],
  );
  return codes.map(signal).filter((s): s is MatchSignal => s !== null);
}
