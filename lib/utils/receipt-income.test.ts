import { describe, expect, it } from "vitest";
import { countsAsIncome, incomeTotal, isReceived, receivedTotal } from "./receipt-income";

const receipt = (overrides: Record<string, unknown> = {}) => ({
  amount: 900,
  status: "paid",
  type: "rent",
  lifecycle: "emitted",
  ...overrides,
});

describe("receipt income", () => {
  it("leaves a voided receipt out: voiding keeps status paid", () => {
    // The bug this exists for: every screen filtered on `status` alone, and a void never
    // touches `status`, so voided money stayed in income.
    expect(isReceived(receipt({ lifecycle: "voided" }))).toBe(false);
    expect(countsAsIncome(receipt({ lifecycle: "voided" }))).toBe(false);
  });

  it("leaves a pending receipt out: nothing arrived", () => {
    expect(isReceived(receipt({ status: "pending" }))).toBe(false);
  });

  it("counts a deposit as received but not as income", () => {
    const deposit = receipt({ type: "deposit" });
    expect(isReceived(deposit)).toBe(true);
    expect(countsAsIncome(deposit)).toBe(false);
  });

  it("counts a receipt with no lifecycle (older rows) by its status", () => {
    expect(countsAsIncome(receipt({ lifecycle: undefined }))).toBe(true);
  });

  it("sums to the cent", () => {
    const rows = [
      receipt({ amount: 0.1 }),
      receipt({ amount: 0.2 }),
      receipt({ amount: 500, type: "deposit" }),
      receipt({ amount: 900, lifecycle: "voided" }),
    ];
    expect(incomeTotal(rows)).toBe(0.3);
    expect(receivedTotal(rows)).toBe(500.3);
  });
});
