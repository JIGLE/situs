import { describe, expect, it, vi } from "vitest";

// tests/setup.ts replaces this module for component tests; this file checks the real one.
const { useCurrency } =
  await vi.importActual<typeof import("./currency-context")>("./currency-context");

describe("useCurrency", () => {
  it("formats every amount as euros", () => {
    const { formatCurrency, currencySymbol } = useCurrency();

    expect(currencySymbol).toBe("€");
    expect(formatCurrency(1234.5)).toBe("€1234,50");
    expect(formatCurrency(0)).toBe("€0,00");
  });

  it("shows a dash when there is no amount", () => {
    const { formatCurrency } = useCurrency();

    expect(formatCurrency(null)).toBe("-");
    expect(formatCurrency(undefined)).toBe("-");
  });
});
