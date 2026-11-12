import { describe, expect, it } from "vitest";
import {
  anniversaryMonth,
  coefficientFor,
  fromMonthValue,
  increasedRent,
  noticeDaysBefore,
  rentForMonth,
  rentIncreaseWarnings,
  suggestedStartMonth,
  toMonthValue,
} from "./rent-increase";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * The yearly update's dates (Código Civil art. 1077): a year from the contract or the last update,
 * never from 1 January, and 30 days' written notice before the first rent at the new amount.
 */
describe("rent increase rules", () => {
  it("counts the year from the contract's start, not the calendar year", () => {
    expect(toMonthValue(anniversaryMonth({ startDate: d("2025-03-15") }))).toBe("2026-03");
  });

  it("counts it from the last increase once there has been one", () => {
    const basis = { startDate: d("2023-03-01"), lastIncreaseFrom: d("2025-05-01") };
    expect(toMonthValue(anniversaryMonth(basis))).toBe("2026-05");
  });

  it("suggests the anniversary when the notice leaves 30 days before it", () => {
    const basis = { startDate: d("2025-03-01") };
    expect(toMonthValue(suggestedStartMonth(basis, d("2026-01-20")))).toBe("2026-03");
  });

  it("moves to the next month when the notice is too late for the anniversary", () => {
    const basis = { startDate: d("2025-03-01") };
    // 15 February leaves 14 days before 1 March, and 43 before 1 April.
    expect(toMonthValue(suggestedStartMonth(basis, d("2026-02-15")))).toBe("2026-04");
  });

  it("counts whole days from the notice to the first of the month", () => {
    expect(noticeDaysBefore(d("2026-01-30"), d("2026-03-01"))).toBe(30);
    expect(noticeDaysBefore(d("2026-01-31"), d("2026-03-01"))).toBe(29);
  });

  it("warns about short notice and an increase within the year, and nothing else", () => {
    const basis = { startDate: d("2025-06-01") };
    expect(rentIncreaseWarnings(basis, d("2026-01-01"), d("2026-07-01"))).toEqual([]);
    expect(rentIncreaseWarnings(basis, d("2026-04-20"), d("2026-05-01"))).toEqual([
      "before_anniversary",
      "short_notice",
    ]);
  });

  it("owes the latest increase that has started by the month, or the current rent", () => {
    const pending = [
      { effectiveFrom: d("2026-08-01"), newRent: 920 },
      { effectiveFrom: d("2027-08-01"), newRent: 940 },
    ];
    expect(rentForMonth(900, pending, d("2026-07-01"))).toBe(900);
    expect(rentForMonth(900, pending, d("2026-08-01"))).toBe(920);
    expect(rentForMonth(900, pending, d("2027-09-01"))).toBe(940);
  });

  it("rounds the new rent to the cent and knows the published coefficients", () => {
    expect(increasedRent(735, 2.24)).toBe(751.46);
    expect(coefficientFor(2026)).toBe(2.24);
    expect(coefficientFor(1999)).toBeNull();
  });

  it("reads a month input and refuses what is not a month", () => {
    expect(fromMonthValue("2026-03")?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(fromMonthValue("2026-13")).toBeNull();
    expect(fromMonthValue("March")).toBeNull();
  });
});
