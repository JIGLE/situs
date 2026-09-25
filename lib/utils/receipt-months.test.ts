import { describe, expect, it } from "vitest";

import { isIssuable, isVoidable, monthKeyString, receiptMonth, shiftMonth } from "./receipt-months";

describe("receiptMonth", () => {
  it("lists a receipt under the rent month it paid", () => {
    expect(receiptMonth({ referenceMonth: "2026-08", date: "2026-09-02" })).toBe("2026-08");
  });

  it("lists one with no rent month under the month it was paid", () => {
    expect(receiptMonth({ referenceMonth: null, date: "2026-09-02" })).toBe("2026-09");
    expect(receiptMonth({ date: "2026-09-02" })).toBe("2026-09");
  });
});

describe("shiftMonth", () => {
  it("moves across the turn of the year both ways", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 9 }, 0)).toEqual({ year: 2026, month: 9 });
  });

  it("writes a month as YYYY-MM", () => {
    expect(monthKeyString({ year: 2026, month: 3 })).toBe("2026-03");
  });
});

describe("isIssuable and isVoidable", () => {
  it.each([
    ["draft", true, true],
    ["review", true, true],
    ["emitted", false, true],
    ["submitted", false, false],
    ["accepted", false, false],
    ["rejected", false, false],
    ["voided", false, false],
    [undefined, false, false],
  ])("%s: issuable %s, voidable %s", (stage, issuable, voidable) => {
    expect(isIssuable(stage)).toBe(issuable);
    expect(isVoidable(stage)).toBe(voidable);
  });
});
