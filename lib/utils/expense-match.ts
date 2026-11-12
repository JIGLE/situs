/**
 * Which recorded expense a payment going out of the bank paid, and what an earlier payment to the
 * same payee says about a new one. Pure, so the import (which links the sure ones on its own) and
 * the movements inbox (which asks about the rest) read a movement the same way.
 *
 * A recurring expense is one series: the template and the copies it makes. Once the owner has said
 * that a payment to this payee was one month of a series, the next month's payment of the same
 * amount, around its date, is that month's copy, and is linked without asking. Anything less sure
 * waits for the owner, as rent does.
 */

export interface OutgoingMovement {
  /** Signed, as the bank gives it: money going out is negative. */
  amount: number;
  bookingDate: Date | string;
  counterpartyIbanHash: string | null;
  counterpartyName: string | null;
}

export interface MatchableExpense {
  id: string;
  amount: number;
  date: Date | string;
  parentExpenseId: string | null;
  vendorVat: string | null;
}

export interface LinkedExpense extends MatchableExpense {
  category: string;
  propertyId: string;
  vendorName: string | null;
  isDeductible: boolean;
}

/** An earlier movement the owner, or the import, linked to an expense. */
export interface ExpenseLinkHistory {
  counterpartyIbanHash: string | null;
  counterpartyName: string | null;
  bookingDate: Date | string;
  expense: LinkedExpense;
}

export type ExpenseMatchReason = "amount_exact" | "date_close" | "date_near" | "known_payee";

export interface ExpenseSuggestion {
  expenseId: string;
  confidence: number;
  reasons: ExpenseMatchReason[];
}

/** Days either side of an expense's date that its payment may be booked on. */
export const EXPENSE_MATCH_WINDOW_DAYS = 10;
/** At or above this, the import links on its own. Reachable only with a known payee. */
export const EXPENSE_AUTO_LINK = 0.85;

const DAY = 86_400_000;

function time(value: Date | string): number {
  return typeof value === "string" ? Date.parse(value.slice(0, 10)) : value.getTime();
}

/** "EDP Comercial, S.A." and "EDP COMERCIAL SA" are one payee. */
function payeeName(name: string | null): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function samePayee(
  movement: Pick<OutgoingMovement, "counterpartyIbanHash" | "counterpartyName">,
  other: Pick<OutgoingMovement, "counterpartyIbanHash" | "counterpartyName">,
): boolean {
  if (movement.counterpartyIbanHash && other.counterpartyIbanHash) {
    return movement.counterpartyIbanHash === other.counterpartyIbanHash;
  }
  const name = payeeName(movement.counterpartyName);
  return name.length > 0 && name === payeeName(other.counterpartyName);
}

/** The recurring expense a copy belongs to; an expense that is no copy is its own series. */
function seriesOf(expense: Pick<MatchableExpense, "id" | "parentExpenseId">): string {
  return expense.parentExpenseId ?? expense.id;
}

function digits(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * The expenses this movement may have paid, surest first: the same amount to the cent, booked
 * within ten days of the expense's date. A payee the owner linked before to the same series, or
 * to the same supplier NIF, makes it sure.
 */
export function suggestExpenses(
  movement: OutgoingMovement,
  expenses: readonly MatchableExpense[],
  history: readonly ExpenseLinkHistory[],
): ExpenseSuggestion[] {
  if (movement.amount >= 0) return [];
  const paid = Math.abs(movement.amount);
  const booked = time(movement.bookingDate);
  const fromPayee = history.filter((link) => samePayee(movement, link));
  const knownSeries = new Set(fromPayee.map((link) => seriesOf(link.expense)));
  const knownNifs = new Set(
    fromPayee.map((link) => digits(link.expense.vendorVat)).filter(Boolean),
  );

  const suggestions: ExpenseSuggestion[] = [];
  for (const expense of expenses) {
    if (Math.abs(expense.amount - paid) >= 0.005) continue;
    const days = Math.abs(booked - time(expense.date)) / DAY;
    if (days > EXPENSE_MATCH_WINDOW_DAYS) continue;
    const reasons: ExpenseMatchReason[] = ["amount_exact", days <= 3 ? "date_close" : "date_near"];
    let confidence = 0.5 + (days <= 3 ? 0.2 : 0.1);
    const nif = digits(expense.vendorVat);
    if (knownSeries.has(seriesOf(expense)) || (nif && knownNifs.has(nif))) {
      reasons.push("known_payee");
      confidence += 0.3;
    }
    suggestions.push({
      expenseId: expense.id,
      confidence: Math.min(1, Math.round(confidence * 100) / 100),
      reasons,
    });
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

/** The one expense the import may link without asking: sure, and nothing else as sure. */
export function sureExpense(suggestions: readonly ExpenseSuggestion[]): string | null {
  const sure = suggestions.filter((s) => s.confidence >= EXPENSE_AUTO_LINK);
  return sure.length === 1 ? sure[0].expenseId : null;
}

/** What the last expense paid to this payee says about a new one: the form opens with it. */
export interface RememberedPayee {
  category: string;
  propertyId: string;
  vendorName: string | null;
  vendorVat: string | null;
  isDeductible: boolean;
}

export function rememberedPayee(
  movement: Pick<OutgoingMovement, "counterpartyIbanHash" | "counterpartyName">,
  history: readonly ExpenseLinkHistory[],
): RememberedPayee | null {
  const last = history
    .filter((link) => samePayee(movement, link))
    .sort((a, b) => time(b.bookingDate) - time(a.bookingDate))[0];
  if (!last) return null;
  const { category, propertyId, vendorName, vendorVat, isDeductible } = last.expense;
  return { category, propertyId, vendorName, vendorVat, isDeductible };
}

/**
 * A copy of a recurring expense whose payment the bank should have shown by now and did not:
 * more than ten days past its date, with no movement linked, and dated after the first movement the
 * bank brought (`since`), since a month before the connection was never going to be seen. Null
 * `since`: no bank, so nothing is said.
 */
export function notSeenInBank(
  expense: { parentExpenseId: string | null; date: Date | string; linked: boolean },
  since: Date | null,
  now: Date,
): boolean {
  if (!since || !expense.parentExpenseId || expense.linked) return false;
  const date = time(expense.date);
  return date >= since.getTime() && now.getTime() - date > EXPENSE_MATCH_WINDOW_DAYS * DAY;
}
