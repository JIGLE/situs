/**
 * Situs matching engine — pure confidence scoring for bank movements.
 *
 * Given an imported bank transaction and the user's active lease candidates,
 * produce an explainable confidence score per candidate and classify the
 * transaction: auto-match (allocate + draft receipt), or send to review.
 * Reconciliation rules run BEFORE scoring in the service layer; a rule hit
 * yields confidence 1.0 with a `rule:<name>` reason.
 *
 * No IO, no Prisma — the service layer feeds snapshots and applies results.
 */

import { MONEY_EPSILON } from "@/lib/utils/money";

export interface TransactionInput {
  id: string;
  amount: number;
  bookingDate: Date;
  counterpartyIbanHash?: string | null;
  counterpartyName?: string | null;
  reference?: string | null;
}

export interface LeaseCandidate {
  leaseId: string;
  tenantName: string;
  monthlyRent: number;
  /** Hashes of IBANs known for this tenant (payment methods, confirmed txns). */
  knownIbanHashes?: string[];
  /** Outstanding remainder of a partially paid period, if any. */
  knownRemainder?: number;
  /** Tokens that identify the property in remittance text (street, unit no.). */
  propertyTokens?: string[];
}

export type MatchReason =
  | "iban_match"
  | "name_match"
  | "amount_exact"
  | "amount_multiple"
  | "amount_remainder"
  | "reference_hit";

export interface CandidateScore {
  leaseId: string;
  confidence: number;
  reasons: MatchReason[];
}

export type MatchStatus = "auto_matched" | "needs_review";

export interface MatchResult {
  status: MatchStatus;
  best: CandidateScore | null;
  scores: CandidateScore[];
  /** True when two candidates are too close to call — never auto-match. */
  ambiguous: boolean;
}

export const MATCH_WEIGHTS = {
  iban: 0.45,
  name: 0.25,
  amount: 0.2,
  reference: 0.1,
} as const;

export const AUTO_MATCH_THRESHOLD = 0.85;
export const SUGGESTION_THRESHOLD = 0.5;
/** Top-two gap below which we refuse to auto-match (equal-rent guard). */
export const AMBIGUITY_GAP = 0.05;

const AMOUNT_TOLERANCE = 0.01; // ±1%

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const token of ta) if (tb.has(token)) hits += 1;
  return hits / Math.min(ta.size, tb.size);
}

function within(value: number, target: number, tolerance: number): boolean {
  return target > 0 && Math.abs(value - target) <= target * tolerance;
}

const RENT_WORDS = ["renda", "rent", "alquiler", "affitto", "aluguer"];

export function scoreCandidate(txn: TransactionInput, candidate: LeaseCandidate): CandidateScore {
  let confidence = 0;
  const reasons: MatchReason[] = [];

  if (txn.counterpartyIbanHash && candidate.knownIbanHashes?.includes(txn.counterpartyIbanHash)) {
    confidence += MATCH_WEIGHTS.iban;
    reasons.push("iban_match");
  }

  if (txn.counterpartyName && tokenOverlap(txn.counterpartyName, candidate.tenantName) >= 0.5) {
    confidence += MATCH_WEIGHTS.name;
    reasons.push("name_match");
  }

  if (within(txn.amount, candidate.monthlyRent, AMOUNT_TOLERANCE)) {
    confidence += MATCH_WEIGHTS.amount;
    reasons.push("amount_exact");
  } else if (
    candidate.knownRemainder !== undefined &&
    within(txn.amount, candidate.knownRemainder, AMOUNT_TOLERANCE)
  ) {
    confidence += MATCH_WEIGHTS.amount / 2;
    reasons.push("amount_remainder");
  } else if ([2, 3].some((n) => within(txn.amount, candidate.monthlyRent * n, AMOUNT_TOLERANCE))) {
    confidence += MATCH_WEIGHTS.amount / 2;
    reasons.push("amount_multiple");
  }

  if (txn.reference) {
    const ref = normalizeText(txn.reference);
    const rentWord = RENT_WORDS.some((w) => ref.includes(w));
    const propertyHit = candidate.propertyTokens?.some(
      (token) => token && ref.includes(normalizeText(token)),
    );
    if (rentWord || propertyHit) {
      confidence += MATCH_WEIGHTS.reference;
      reasons.push("reference_hit");
    }
  }

  return { leaseId: candidate.leaseId, confidence: round3(confidence), reasons };
}

export function classifyMatch(txn: TransactionInput, candidates: LeaseCandidate[]): MatchResult {
  const scores = candidates
    .map((c) => scoreCandidate(txn, c))
    .sort((a, b) => b.confidence - a.confidence);

  const best = scores[0] ?? null;
  const runnerUp = scores[1];
  const ambiguous = !!best && !!runnerUp && best.confidence - runnerUp.confidence < AMBIGUITY_GAP;

  const status: MatchStatus =
    best && best.confidence >= AUTO_MATCH_THRESHOLD && !ambiguous ? "auto_matched" : "needs_review";

  return { status, best, scores, ambiguous };
}

/**
 * Fuzzy duplicate detection at import time: same counterparty, same amount,
 * booked within `windowDays` of an already-known transaction. Exact
 * duplicates are stopped earlier by the fingerprint unique constraint.
 */
export function findPossibleDuplicate(
  txn: TransactionInput,
  previous: TransactionInput[],
  windowDays = 3,
): string | null {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  for (const prior of previous) {
    if (prior.id === txn.id) continue;
    if (Math.abs(prior.amount - txn.amount) > 0.005) continue;
    const sameIban =
      !!txn.counterpartyIbanHash && prior.counterpartyIbanHash === txn.counterpartyIbanHash;
    const sameName =
      !!txn.counterpartyName &&
      !!prior.counterpartyName &&
      normalizeText(prior.counterpartyName) === normalizeText(txn.counterpartyName);
    if (!sameIban && !sameName) continue;
    if (Math.abs(prior.bookingDate.getTime() - txn.bookingDate.getTime()) <= windowMs) {
      return prior.id;
    }
  }
  return null;
}

/**
 * A payment the owner recorded by hand that a bank movement could be the same money as. Only what
 * the match needs: the service layer reads these off receipts.
 */
export interface RecordedPayment {
  id: string;
  amount: number;
  date: Date;
}

/** How far a recorded payment's date may sit from the movement's booking date. */
export const RECORDED_PAYMENT_WINDOW_DAYS = 10;

/**
 * The recorded payments a movement may be the same money as: the same amount to the cent, dated
 * within `windowDays` of the booking, nearest first. The caller has already narrowed them to one
 * lease's paid rent that no movement is linked to. There can be more than one, and which of them
 * the movement is is the owner's to say, so nothing here picks.
 */
export function findRecordedPayments(
  txn: Pick<TransactionInput, "amount" | "bookingDate">,
  recorded: RecordedPayment[],
  windowDays = RECORDED_PAYMENT_WINDOW_DAYS,
): RecordedPayment[] {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const distance = (payment: RecordedPayment) =>
    Math.abs(payment.date.getTime() - txn.bookingDate.getTime());
  return recorded
    .filter(
      (payment) =>
        Math.abs(payment.amount - txn.amount) <= MONEY_EPSILON && distance(payment) <= windowMs,
    )
    .sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id));
}

/**
 * Parse an explicit reference month out of remittance text ("07/2026",
 * "2026-07"). The waterfall never silently obeys this — when it disagrees
 * with the computed target the transaction goes to review with both shown.
 */
export function parseReferenceMonth(reference: string): { year: number; month: number } | null {
  const mmYyyy = reference.match(/\b(0?[1-9]|1[0-2])\s*[/\-.]\s*(20\d{2})\b/);
  if (mmYyyy) return { year: Number(mmYyyy[2]), month: Number(mmYyyy[1]) };
  const yyyyMm = reference.match(/\b(20\d{2})\s*[/\-.]\s*(0?[1-9]|1[0-2])\b/);
  if (yyyyMm) return { year: Number(yyyyMm[1]), month: Number(yyyyMm[2]) };
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
