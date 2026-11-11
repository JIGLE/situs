import { describe, expect, it } from "vitest";
import {
  defaultLeaseTerm,
  onPropertyChosen,
  onRentChanged,
  onStartChanged,
  oneYearTermEnd,
} from "./lease-defaults";

const draft = (over: Partial<Parameters<typeof onRentChanged>[0]> = {}) => ({
  startDate: "2026-12-01",
  endDate: "2027-11-30",
  monthlyRent: 0,
  deposit: 0,
  ...over,
});

describe("defaultLeaseTerm", () => {
  it("starts on the 1st of next month and runs one year", () => {
    expect(defaultLeaseTerm(new Date(2026, 10, 11))).toEqual({
      startDate: "2026-12-01",
      endDate: "2027-11-30",
    });
  });

  it("rolls over the year in December", () => {
    expect(defaultLeaseTerm(new Date(2026, 11, 31))).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
  });
});

describe("oneYearTermEnd", () => {
  it("ends the day before the anniversary", () => {
    expect(oneYearTermEnd("2026-03-15")).toBe("2027-03-14");
  });

  it("handles a leap day", () => {
    expect(oneYearTermEnd("2028-02-29")).toBe("2029-02-28");
  });

  it("answers nothing for an unreadable date", () => {
    expect(oneYearTermEnd("")).toBe("");
  });
});

describe("onPropertyChosen", () => {
  it("takes the property's rent and a one-month deposit", () => {
    expect(onPropertyChosen(draft(), 850)).toEqual({ monthlyRent: 850, deposit: 850 });
  });

  it("keeps a rent already typed", () => {
    expect(onPropertyChosen(draft({ monthlyRent: 900 }), 850)).toEqual({});
  });

  it("keeps a deposit already typed", () => {
    expect(onPropertyChosen(draft({ deposit: 2000 }), 850)).toEqual({ monthlyRent: 850 });
  });

  it("changes nothing for a property with no rent", () => {
    expect(onPropertyChosen(draft(), 0)).toEqual({});
    expect(onPropertyChosen(draft(), null)).toEqual({});
  });
});

describe("onRentChanged", () => {
  it("moves a deposit that mirrors the rent", () => {
    expect(onRentChanged(draft({ monthlyRent: 850, deposit: 850 }), 900)).toEqual({
      monthlyRent: 900,
      deposit: 900,
    });
  });

  it("leaves a deposit the owner set", () => {
    expect(onRentChanged(draft({ monthlyRent: 850, deposit: 1700 }), 900)).toEqual({
      monthlyRent: 900,
    });
  });
});

describe("onStartChanged", () => {
  it("moves an end date that is still the default term", () => {
    expect(onStartChanged(draft(), "2027-01-01")).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
  });

  it("leaves an end date the owner set", () => {
    expect(onStartChanged(draft({ endDate: "2031-11-30" }), "2027-01-01")).toEqual({
      startDate: "2027-01-01",
    });
  });
});
