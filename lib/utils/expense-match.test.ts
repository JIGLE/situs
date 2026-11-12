import { describe, expect, it } from "vitest";

import {
  notSeenInBank,
  rememberedPayee,
  suggestExpenses,
  sureExpense,
  type ExpenseLinkHistory,
  type MatchableExpense,
} from "./expense-match";

const condo = (
  id: string,
  date: string,
  extra: Partial<MatchableExpense> = {},
): MatchableExpense => ({
  id,
  amount: 45,
  date,
  parentExpenseId: "tpl",
  vendorVat: null,
  ...extra,
});

const payment = {
  amount: -45,
  bookingDate: "2026-11-03",
  counterpartyIbanHash: "v2:condo",
  counterpartyName: "Condominio Rua Alegre",
};

/** October's copy was paid from the same account, and the owner said so. */
const history: ExpenseLinkHistory[] = [
  {
    counterpartyIbanHash: "v2:condo",
    counterpartyName: "Condominio Rua Alegre",
    bookingDate: "2026-10-02",
    expense: {
      ...condo("oct", "2026-10-01"),
      category: "condominium_fees",
      propertyId: "prop-1",
      vendorName: "Condomínio",
      isDeductible: true,
    },
  },
];

describe("suggestExpenses", () => {
  it("is sure of this month's copy once the payee paid the series before", () => {
    const suggestions = suggestExpenses(payment, [condo("nov", "2026-11-01")], history);
    expect(suggestions).toEqual([
      {
        expenseId: "nov",
        confidence: 1,
        reasons: ["amount_exact", "date_close", "known_payee"],
      },
    ]);
    expect(sureExpense(suggestions)).toBe("nov");
  });

  it("only suggests, the first time, and leaves the owner to say", () => {
    const suggestions = suggestExpenses(payment, [condo("nov", "2026-11-01")], []);
    expect(suggestions[0]?.confidence).toBe(0.7);
    expect(sureExpense(suggestions)).toBeNull();
  });

  it("knows a payee by the supplier NIF the owner linked before", () => {
    const withNif: ExpenseLinkHistory[] = [
      {
        ...history[0],
        expense: { ...history[0].expense, parentExpenseId: null, vendorVat: "PT 501 234 567" },
      },
    ];
    const one = condo("water", "2026-11-05", { parentExpenseId: null, vendorVat: "501234567" });
    expect(suggestExpenses(payment, [one], withNif)[0]?.reasons).toContain("known_payee");
  });

  it("needs the amount to the cent, and the day within ten", () => {
    expect(
      suggestExpenses(payment, [condo("a", "2026-11-01", { amount: 45.01 })], history),
    ).toEqual([]);
    expect(suggestExpenses(payment, [condo("b", "2026-10-20")], history)).toEqual([]);
    expect(suggestExpenses(payment, [condo("c", "2026-10-26")], history)[0]?.reasons).toContain(
      "date_near",
    );
  });

  it("never reads money coming in as an expense", () => {
    expect(
      suggestExpenses({ ...payment, amount: 45 }, [condo("nov", "2026-11-01")], history),
    ).toEqual([]);
  });

  it("links nothing on its own when two months are as sure", () => {
    const suggestions = suggestExpenses(
      payment,
      [condo("nov", "2026-11-01"), condo("nov-b", "2026-11-02")],
      history,
    );
    expect(sureExpense(suggestions)).toBeNull();
  });

  it("knows a payee by name when the bank gives no account", () => {
    const byName = {
      ...payment,
      counterpartyIbanHash: null,
      counterpartyName: "CONDOMINIO RUA ALEGRE",
    };
    const named = [{ ...history[0], counterpartyIbanHash: null }];
    expect(suggestExpenses(byName, [condo("nov", "2026-11-01")], named)[0]?.reasons).toContain(
      "known_payee",
    );
  });
});

describe("rememberedPayee", () => {
  it("opens the form with what the payee was last time", () => {
    expect(rememberedPayee(payment, history)).toEqual({
      category: "condominium_fees",
      propertyId: "prop-1",
      vendorName: "Condomínio",
      vendorVat: null,
      isDeductible: true,
    });
    expect(rememberedPayee({ ...payment, counterpartyIbanHash: "v2:other" }, history)).toBeNull();
  });
});

describe("notSeenInBank", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const since = new Date("2026-09-01");
  const copy = { parentExpenseId: "tpl", date: "2026-11-01", linked: false };

  it("says so of a recurring month ten days past with no payment", () => {
    expect(notSeenInBank(copy, since, now)).toBe(true);
  });

  it("says nothing without a bank, before it, of a paid month, a recent one, or a one-off", () => {
    expect(notSeenInBank(copy, null, now)).toBe(false);
    expect(notSeenInBank({ ...copy, date: "2026-08-01" }, since, now)).toBe(false);
    expect(notSeenInBank({ ...copy, linked: true }, since, now)).toBe(false);
    expect(notSeenInBank({ ...copy, date: "2026-11-15" }, since, now)).toBe(false);
    expect(notSeenInBank({ ...copy, parentExpenseId: null }, since, now)).toBe(false);
  });
});
