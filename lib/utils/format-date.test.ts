import { afterEach, describe, expect, it } from "vitest";

import { formatMonth, formatMonthYear } from "./format-date";

/**
 * Reference months are named in the app's language, not from a hardcoded English list, and a
 * month stays itself in every timezone: midnight UTC on the 1st of September is still the 31st of
 * August anywhere west of Greenwich.
 */

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("formatMonth", () => {
  it("names a month in the app's language", () => {
    expect(formatMonth(2026, 9, "pt")).toBe("set.");
    expect(formatMonth(2026, 9, "en")).toBe("Sep");
    expect(formatMonth(2026, 9, "pt", "long")).toBe("setembro");
  });

  it("names January and December as themselves", () => {
    expect(formatMonth(2026, 1, "pt", "long")).toBe("janeiro");
    expect(formatMonth(2026, 12, "pt", "long")).toBe("dezembro");
  });

  it("keeps the month where the server's clock is behind UTC", () => {
    process.env.TZ = "America/Los_Angeles";

    expect(formatMonth(2026, 9, "en")).toBe("Sep");
    expect(formatMonthYear(2026, 1, "en")).toBe("January 2026");
  });
});

describe("formatMonthYear", () => {
  it("names the month with its year", () => {
    expect(formatMonthYear(2026, 9, "pt")).toBe("setembro de 2026");
    expect(formatMonthYear(2026, 9, "en")).toBe("September 2026");
  });
});
