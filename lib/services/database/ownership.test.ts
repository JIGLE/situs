import { describe, expect, it } from "vitest";
import { dayOf, inForceOn, isInForceOn, lastChangeOf } from "./ownership";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("ownership", () => {
  it("reads a date as the UTC day it falls on", () => {
    expect(dayOf("2026-09-15T23:59:00.000Z")).toEqual(day("2026-09-15"));
    expect(dayOf(new Date("2026-09-15T00:00:01.000Z"))).toEqual(day("2026-09-15"));
  });

  it("holds a share from its first day up to, not including, the day it ends", () => {
    const sold = { validFrom: null, validTo: day("2026-09-15") };
    const bought = { validFrom: day("2026-09-15"), validTo: null };
    expect(isInForceOn(sold, day("2026-09-14"))).toBe(true);
    expect(isInForceOn(sold, day("2026-09-15"))).toBe(false);
    expect(isInForceOn(bought, day("2026-09-14"))).toBe(false);
    expect(isInForceOn(bought, day("2026-09-15"))).toBe(true);
  });

  it("asks the database the same question", () => {
    expect(inForceOn(day("2026-09-15"))).toEqual({
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: day("2026-09-15") } }] },
        { OR: [{ validTo: null }, { validTo: { gt: day("2026-09-15") } }] },
      ],
    });
  });

  it("finds the last day the shares changed, or none", () => {
    expect(lastChangeOf([{ validFrom: null, validTo: null }])).toBeNull();
    expect(
      lastChangeOf([
        { validFrom: null, validTo: day("2026-03-01") },
        { validFrom: day("2026-03-01"), validTo: day("2026-09-15") },
        { validFrom: day("2026-01-01"), validTo: null },
      ]),
    ).toEqual(day("2026-09-15"));
  });
});
