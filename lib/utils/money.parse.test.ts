import { describe, expect, it } from "vitest";
import { parseAmountInput } from "./money";

describe("parseAmountInput", () => {
  it.each([
    ["3200,00", 3200],
    ["3.200,00", 3200],
    ["3,200.00", 3200],
    ["3200.5", 3200.5],
    ["3200", 3200],
    ["3.200", 3200],
    ["3 200,50 €", 3200.5],
    ["12,5", 12.5],
  ])("reads %s as %d", (raw, value) => {
    expect(parseAmountInput(raw)).toBe(value);
  });

  it.each(["", "abc", "-5", "1,2,3", "12,5x"])("refuses %s", (raw) => {
    expect(parseAmountInput(raw)).toBeNaN();
  });
});
