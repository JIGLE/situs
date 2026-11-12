import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrencesBetween } from "./expense-recurrence";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const days = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));

describe("occurrencesBetween", () => {
  it("repeats monthly after the expense itself, catching up missed months", () => {
    const template = { date: "2026-08-01", recurrenceRule: "monthly", recurrenceDay: 1 };
    expect(days(occurrencesBetween(template, day("2026-11-12")))).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
  });

  it("starts after the last copy made, so a deleted copy is not made again", () => {
    const template = { date: "2026-08-01", recurrenceRule: "monthly", recurrenceDay: 1 };
    expect(days(occurrencesBetween(template, day("2026-11-12"), day("2026-10-01")))).toEqual([
      "2026-11-01",
    ]);
  });

  it("clamps the day to short months and steps quarterly and yearly", () => {
    expect(
      days(
        occurrencesBetween(
          { date: "2026-01-31", recurrenceRule: "monthly", recurrenceDay: 31 },
          day("2026-03-31"),
        ),
      ),
    ).toEqual(["2026-02-28", "2026-03-31"]);
    expect(
      days(
        occurrencesBetween(
          { date: "2026-01-15", recurrenceRule: "quarterly", recurrenceDay: 15 },
          day("2026-12-31"),
        ),
      ),
    ).toEqual(["2026-04-15", "2026-07-15", "2026-10-15"]);
    expect(
      days(
        occurrencesBetween(
          { date: "2025-04-30", recurrenceRule: "annual", recurrenceDay: 28 },
          day("2027-05-01"),
        ),
      ),
    ).toEqual(["2026-04-28", "2027-04-28"]);
  });

  it("stops at the end date", () => {
    const template = {
      date: "2026-01-01",
      recurrenceRule: "monthly",
      recurrenceDay: 1,
      recurrenceEnd: "2026-03-15",
    };
    expect(days(occurrencesBetween(template, day("2026-11-12")))).toEqual([
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(nextOccurrence(template, day("2026-11-12"))).toBeNull();
  });
});

describe("nextOccurrence", () => {
  it("is the first date after now", () => {
    const template = { date: "2026-08-05", recurrenceRule: "monthly", recurrenceDay: 5 };
    expect(nextOccurrence(template, day("2026-11-12"))?.toISOString().slice(0, 10)).toBe(
      "2026-12-05",
    );
  });
});
