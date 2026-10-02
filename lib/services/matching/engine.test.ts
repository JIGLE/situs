import { describe, expect, it } from "vitest";

import {
  AUTO_MATCH_THRESHOLD,
  RECORDED_PAYMENT_WINDOW_DAYS,
  classifyMatch,
  findPossibleDuplicate,
  findRecordedPayments,
  parseReferenceMonth,
  scoreCandidate,
  type LeaseCandidate,
  type RecordedPayment,
  type TransactionInput,
} from "./engine";

const RENT = 950;

const lease: LeaseCandidate = {
  leaseId: "lease-1",
  tenantName: "João Silva",
  monthlyRent: RENT,
  knownIbanHashes: ["hash-joao"],
  propertyTokens: ["Rua Augusta"],
};

function txn(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    id: "txn-1",
    amount: RENT,
    bookingDate: new Date("2026-06-01"),
    counterpartyIbanHash: "hash-joao",
    counterpartyName: "Joao Silva",
    reference: "Renda Junho Rua Augusta",
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("full signal stack (IBAN + name + amount + reference) reaches auto-match confidence", () => {
    const score = scoreCandidate(txn(), lease);
    expect(score.reasons).toEqual(
      expect.arrayContaining(["iban_match", "name_match", "amount_exact", "reference_hit"]),
    );
    expect(score.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("name matching tolerates diacritics and order", () => {
    const score = scoreCandidate(
      txn({ counterpartyIbanHash: null, counterpartyName: "SILVA Joao" }),
      lease,
    );
    expect(score.reasons).toContain("name_match");
  });

  it("amount within ±1% counts as exact; a known remainder scores half", () => {
    expect(scoreCandidate(txn({ amount: RENT * 1.005 }), lease).reasons).toContain("amount_exact");
    const partial = scoreCandidate(txn({ amount: 550 }), { ...lease, knownRemainder: 550 });
    expect(partial.reasons).toContain("amount_remainder");
  });

  it("unknown payer: no signals fire → confidence below suggestion threshold", () => {
    const score = scoreCandidate(
      txn({
        counterpartyIbanHash: "hash-stranger",
        counterpartyName: "Unrelated Corp Lda",
        amount: 123.45,
        reference: "invoice 998877",
      }),
      lease,
    );
    expect(score.reasons).toEqual([]);
    expect(score.confidence).toBe(0);
  });
});

describe("classifyMatch", () => {
  const leaseB: LeaseCandidate = {
    leaseId: "lease-2",
    tenantName: "João Silva",
    monthlyRent: 1200,
    knownIbanHashes: ["hash-joao"],
    propertyTokens: ["Villa Cascais"],
  };

  it("multi-property tenant: amount disambiguates the lease", () => {
    const result = classifyMatch(txn({ amount: 1200, reference: "renda" }), [lease, leaseB]);
    expect(result.best?.leaseId).toBe("lease-2");
    expect(result.status).toBe("auto_matched");
  });

  it("equal-rent ambiguity guard: top-two too close → needs_review, never auto", () => {
    const equalRent = { ...leaseB, monthlyRent: RENT, propertyTokens: ["Rua Augusta"] };
    const result = classifyMatch(txn(), [lease, equalRent]);
    expect(result.ambiguous).toBe(true);
    expect(result.status).toBe("needs_review");
  });

  it("weak evidence stays in review even as best candidate", () => {
    const result = classifyMatch(
      txn({ counterpartyIbanHash: null, counterpartyName: null, reference: null }),
      [lease],
    );
    expect(result.best?.leaseId).toBe("lease-1");
    expect(result.status).toBe("needs_review");
  });
});

describe("findPossibleDuplicate", () => {
  const prior = txn({ id: "txn-0", bookingDate: new Date("2026-05-31") });

  it("same counterparty + amount within 3 days → flags the prior transaction", () => {
    expect(findPossibleDuplicate(txn(), [prior])).toBe("txn-0");
  });

  it("outside the window or different amount → no flag", () => {
    expect(findPossibleDuplicate(txn({ bookingDate: new Date("2026-06-10") }), [prior])).toBeNull();
    expect(findPossibleDuplicate(txn({ amount: RENT + 50 }), [prior])).toBeNull();
  });

  it("matches on normalized name when IBAN is missing", () => {
    const noIban = txn({ counterpartyIbanHash: null, counterpartyName: "JOÃO  SILVA" });
    const priorNoIban = txn({
      id: "txn-0",
      counterpartyIbanHash: null,
      counterpartyName: "joao silva",
      bookingDate: new Date("2026-05-31"),
    });
    expect(findPossibleDuplicate(noIban, [priorNoIban])).toBe("txn-0");
  });
});

describe("findRecordedPayments", () => {
  const booked = { amount: RENT, bookingDate: new Date("2026-06-10") };
  const recorded = (id: string, date: string, amount = RENT): RecordedPayment => ({
    id,
    amount,
    date: new Date(date),
  });

  it("finds a payment for the same amount recorded around the booking date", () => {
    expect(findRecordedPayments(booked, [recorded("r-1", "2026-06-02")])).toEqual([
      recorded("r-1", "2026-06-02"),
    ]);
  });

  it("is the same money only to the cent", () => {
    expect(findRecordedPayments(booked, [recorded("r-1", "2026-06-10", RENT + 0.01)])).toEqual([]);
    expect(findRecordedPayments(booked, [recorded("r-1", "2026-06-10", RENT - 0.01)])).toEqual([]);
    // Float noise from a sum of cents is not a difference.
    expect(findRecordedPayments(booked, [recorded("r-1", "2026-06-10", RENT + 1e-9)])).toHaveLength(
      1,
    );
  });

  it(`looks ${RECORDED_PAYMENT_WINDOW_DAYS} days either side of the booking, and no further`, () => {
    expect(RECORDED_PAYMENT_WINDOW_DAYS).toBe(10);
    const ids = (dates: string[]) =>
      findRecordedPayments(
        booked,
        dates.map((date) => recorded(`r-${date}`, date)),
      ).map((payment) => payment.id);

    expect(ids(["2026-05-31", "2026-06-20"])).toEqual(["r-2026-05-31", "r-2026-06-20"]);
    expect(ids(["2026-05-30"])).toEqual([]);
    expect(ids(["2026-06-21"])).toEqual([]);
  });

  it("gives every payment that fits, nearest first, and picks none", () => {
    const found = findRecordedPayments(booked, [
      recorded("r-far", "2026-06-01"),
      recorded("r-near", "2026-06-09"),
      recorded("r-b", "2026-06-12"),
      recorded("r-a", "2026-06-08"),
      recorded("r-wrong-amount", "2026-06-10", RENT * 2),
    ]);

    // r-a and r-b are both two days off: the tie goes to the id, so the order is stable.
    expect(found.map((payment) => payment.id)).toEqual(["r-near", "r-a", "r-b", "r-far"]);
  });

  it("finds nothing among nothing, and takes a window of its own", () => {
    expect(findRecordedPayments(booked, [])).toEqual([]);
    expect(findRecordedPayments(booked, [recorded("r-1", "2026-06-02")], 7)).toHaveLength(0);
    expect(findRecordedPayments(booked, [recorded("r-1", "2026-06-02")], 8)).toHaveLength(1);
  });
});

describe("parseReferenceMonth", () => {
  it("parses MM/YYYY and YYYY-MM forms", () => {
    expect(parseReferenceMonth("renda 07/2026")).toEqual({ year: 2026, month: 7 });
    expect(parseReferenceMonth("2026-07 rua augusta")).toEqual({ year: 2026, month: 7 });
  });

  it("returns null when no month token exists (wrong-reference guard input)", () => {
    expect(parseReferenceMonth("transferencia familiar")).toBeNull();
  });
});
