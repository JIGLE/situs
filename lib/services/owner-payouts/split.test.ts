import { describe, expect, it } from "vitest";

import { splitCents, splitProperty, splitYear, UNASSIGNED, type ShareRow } from "./split";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const share = (
  ownerId: string,
  percentage: number,
  validFrom: string | null = null,
  validTo: string | null = null,
): ShareRow => ({
  ownerId,
  ownerName: ownerId.toUpperCase(),
  percentage,
  validFrom: validFrom ? day(validFrom) : null,
  validTo: validTo ? day(validTo) : null,
});

const months = (amount: number, year = 2026) =>
  Array.from({ length: 12 }, (_, i) => ({ amount, day: new Date(Date.UTC(year, i, 1)) }));

describe("splitCents", () => {
  it("rounds each part so the parts add up to the total to the cent", () => {
    const parts = splitCents(
      new Map([
        ["a", 100 / 3],
        ["b", 100 / 3],
        ["c", 100 / 3],
      ]),
      100,
    );
    expect([...parts.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(100, 10);
    expect([...parts.values()].sort()).toEqual([33.33, 33.33, 33.34]);
  });
});

describe("splitProperty", () => {
  it("splits a year's rent less expenses by each owner's share", () => {
    const split = splitProperty(
      {
        propertyId: "p1",
        propertyName: "T2 Lisboa",
        shares: [share("ana", 50), share("rui", 25), share("eva", 25)],
        income: months(1000),
        expenses: [{ amount: 600, day: day("2026-03-10") }],
      },
      2026,
    );

    expect(split).toMatchObject({ income: 12000, expenses: 600, net: 11400, unassigned: null });
    expect(split.sharesChanged).toBe(false);
    expect(split.owners.map((o) => [o.ownerId, o.income, o.expenses, o.net])).toEqual([
      ["ana", 6000, 300, 5700],
      ["eva", 3000, 150, 2850],
      ["rui", 3000, 150, 2850],
    ]);
  });

  it("splits each month by the shares in force on it when they change mid-year", () => {
    const split = splitProperty(
      {
        propertyId: "p1",
        propertyName: "T2",
        // Ana sold half her share to Rui on 1 July.
        shares: [
          share("ana", 100, null, "2026-07-01"),
          share("ana", 50, "2026-07-01"),
          share("rui", 50, "2026-07-01"),
        ],
        income: months(1000),
        expenses: [],
      },
      2026,
    );

    expect(split.sharesChanged).toBe(true);
    const ana = split.owners.find((o) => o.ownerId === "ana")!;
    const rui = split.owners.find((o) => o.ownerId === "rui")!;
    expect(ana).toMatchObject({ percentages: [100, 50], net: 9000 });
    expect(rui).toMatchObject({ percentages: [50], net: 3000 });
  });

  it("keeps money from days no share covers apart, rather than giving it to someone", () => {
    const split = splitProperty(
      {
        propertyId: "p1",
        propertyName: "T2",
        shares: [share("ana", 60)],
        income: [{ amount: 1000, day: day("2026-02-01") }],
        expenses: [],
      },
      2026,
    );

    expect(split.owners[0].net).toBe(600);
    expect(split.unassigned).toEqual({ income: 400, expenses: 0, net: 400 });
  });

  it("pays back in full an expense one owner paid themselves", () => {
    const split = splitProperty(
      {
        propertyId: "p1",
        propertyName: "T2",
        shares: [share("ana", 50), share("rui", 50)],
        income: [{ amount: 1000, day: day("2026-02-01") }],
        expenses: [{ amount: 200, day: day("2026-02-10"), paidByOwnerId: "rui" }],
      },
      2026,
    );

    const net = Object.fromEntries(split.owners.map((o) => [o.ownerId, o.net]));
    expect(net).toEqual({ ana: 400, rui: 600 });
  });

  it("never names the unassigned bucket as an owner", () => {
    const split = splitProperty(
      { propertyId: "p1", propertyName: "T2", shares: [], income: months(10), expenses: [] },
      2026,
    );
    expect(split.owners.some((o) => o.ownerId === UNASSIGNED)).toBe(false);
  });
});

describe("splitYear", () => {
  it("adds each owner's parts across properties and takes off what was paid out", () => {
    const year = splitYear(
      2026,
      [
        {
          propertyId: "p1",
          propertyName: "Shared",
          shares: [share("ana", 50), share("rui", 50)],
          income: months(1000),
          expenses: [{ amount: 1000, day: day("2026-06-01") }],
        },
        {
          propertyId: "p2",
          propertyName: "Rui's own",
          shares: [share("rui", 100)],
          income: months(500),
          expenses: [],
        },
        {
          propertyId: "p3",
          propertyName: "Sold before the year",
          shares: [share("eva", 100, null, "2025-01-01")],
          income: [],
          expenses: [],
        },
      ],
      [{ id: "x1", ownerId: "rui", amount: 2000, paidAt: day("2026-07-01"), note: null }],
    );

    expect(year.properties.map((p) => p.propertyId)).toEqual(["p1", "p2"]);
    expect(year).toMatchObject({ income: 18000, expenses: 1000, net: 17000, paid: 2000 });
    const rui = year.owners.find((o) => o.ownerId === "rui")!;
    expect(rui).toMatchObject({ net: 11500, paid: 2000, balance: 9500, propertyIds: ["p1", "p2"] });
    const ana = year.owners.find((o) => o.ownerId === "ana")!;
    expect(ana).toMatchObject({ net: 5500, paid: 0, balance: 5500 });
    expect(year.outstanding).toBe(15000);
  });

  it("shows a payout to an owner with no share that year, so it is not lost", () => {
    const year = splitYear(
      2026,
      [],
      [{ id: "x1", ownerId: "eva", amount: 50, paidAt: day("2026-01-05"), note: null }],
    );
    expect(year.owners).toHaveLength(1);
    expect(year.owners[0]).toMatchObject({ ownerId: "eva", balance: -50 });
    expect(year.outstanding).toBe(0);
  });
});

describe("splitYear, shared properties only", () => {
  it("leaves out a property one owner holds alone, and counts it", () => {
    const year = splitYear(
      2026,
      [
        {
          propertyId: "p1",
          propertyName: "Shared",
          shares: [share("ana", 50), share("rui", 50)],
          income: months(100),
          expenses: [],
        },
        {
          propertyId: "p2",
          propertyName: "Ana's own",
          shares: [share("ana", 100)],
          income: months(1000),
          expenses: [],
        },
      ],
      [],
      { sharedOnly: true },
    );

    expect(year.properties.map((p) => p.propertyId)).toEqual(["p1"]);
    expect(year.soleOwnerProperties).toBe(1);
    expect(year).toMatchObject({ income: 1200, outstanding: 1200 });
    expect(year.owners.find((o) => o.ownerId === "ana")).toMatchObject({ net: 600 });
  });
});

describe("splitYear, with the owner who collects the rent", () => {
  it("leaves what the collector keeps out of what is still to pay, and lists them last", () => {
    const year = splitYear(
      2026,
      [
        {
          propertyId: "p1",
          propertyName: "Shared",
          shares: [share("ana", 50), share("rui", 50)],
          income: months(100),
          expenses: [],
        },
      ],
      [],
      { collectors: new Set(["ana"]) },
    );

    expect(year.outstanding).toBe(600);
    expect(year.owners.map((o) => [o.ownerId, o.collects, o.balance])).toEqual([
      ["rui", false, 600],
      ["ana", true, 600],
    ]);
  });
});
