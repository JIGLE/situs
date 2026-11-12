import { describe, expect, it } from "vitest";

import { derivePeriodStatus, deriveTenantStatus, periodDueDate, planAllocation } from "./engine";
import type { PeriodSnapshot } from "./types";

const RENT = 950;

function period(
  year: number,
  month: number,
  allocatedAmount = 0,
  dueAmount = RENT,
): PeriodSnapshot {
  return { id: `p-${year}-${month}`, year, month, dueAmount, allocatedAmount };
}

function payment(amount: number, iso = "2026-06-01") {
  return { id: "txn-1", amount, bookingDate: new Date(iso) };
}

describe("planAllocation — reference-month waterfall", () => {
  it("current tenant, exact rent on June 1 → allocates to July (next unfilled)", () => {
    // Jan–Jun fully paid; July is the oldest unfilled period.
    const periods = [
      ...[1, 2, 3, 4, 5, 6].map((m) => period(2026, m, RENT)),
      period(2026, 7),
      period(2026, 8),
    ];
    const plan = planAllocation({ payment: payment(RENT), periods });
    expect(plan.warnings).toEqual([]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      period: { year: 2026, month: 7 },
      amount: RENT,
      type: "rent",
    });
  });

  it("tenant one month behind → oldest unpaid month is settled first", () => {
    const periods = [period(2026, 5), period(2026, 6), period(2026, 7)];
    const plan = planAllocation({ payment: payment(RENT), periods });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].period).toMatchObject({ year: 2026, month: 5 });
    expect(plan.entries[0].type).toBe("rent");
  });

  it("partial payment fills the oldest period partially", () => {
    const periods = [period(2026, 6), period(2026, 7)];
    const plan = planAllocation({ payment: payment(400), periods });
    expect(plan.entries).toEqual([
      { period: { year: 2026, month: 6, id: "p-2026-6" }, amount: 400, type: "partial" },
    ]);
  });

  it("second partial completes the period (fills the open remainder)", () => {
    const periods = [period(2026, 6, 400), period(2026, 7)];
    const plan = planAllocation({ payment: payment(550), periods });
    expect(plan.entries).toEqual([
      { period: { year: 2026, month: 6, id: "p-2026-6" }, amount: 550, type: "rent" },
    ]);
  });

  it("overpayment (1.5×) fills oldest, then carries forward as credit", () => {
    const periods = [period(2026, 6), period(2026, 7)];
    const plan = planAllocation({ payment: payment(RENT * 1.5), periods });
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0]).toMatchObject({ period: { month: 6 }, amount: RENT, type: "rent" });
    expect(plan.entries[1]).toMatchObject({
      period: { month: 7 },
      amount: RENT / 2,
      type: "overpayment_credit",
    });
  });

  it("overpayment beyond known periods creates future periods deterministically", () => {
    const periods = [period(2026, 11), period(2026, 12)];
    const plan = planAllocation({ payment: payment(RENT * 4), periods });
    expect(plan.entries).toHaveLength(4);
    // Created periods roll into the next year.
    expect(plan.entries[2].period).toMatchObject({ year: 2027, month: 1, created: true });
    expect(plan.entries[3].period).toMatchObject({ year: 2027, month: 2, created: true });
    expect(plan.entries.every((e, i) => i === 0 || e.type === "overpayment_credit")).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  it("overpayment beyond the horizon is reported, never silently dropped", () => {
    const periods = [period(2026, 6)];
    const plan = planAllocation({
      payment: payment(RENT * 4),
      periods,
      horizonMonths: 2,
    });
    // 1 known + 2 created periods absorbed; 1 month of rent left over.
    expect(plan.entries).toHaveLength(3);
    expect(plan.warnings).toEqual([{ code: "horizon_exceeded", unallocated: RENT }]);
  });

  it("non-positive amounts produce no entries and a warning", () => {
    const plan = planAllocation({ payment: payment(0), periods: [period(2026, 6)] });
    expect(plan.entries).toEqual([]);
    expect(plan.warnings).toEqual([{ code: "non_positive_amount" }]);
  });

  it("no known periods → explicit warning (service must generate periods first)", () => {
    const plan = planAllocation({ payment: payment(RENT), periods: [] });
    expect(plan.entries).toEqual([]);
    expect(plan.warnings).toEqual([{ code: "no_period_context" }]);
  });
});

/**
 * The cases above cover a 1.5× overpayment and a 4× one that spills into engine-created future
 * periods. Neither is the case a landlord in arrears actually produces: a payment that settles
 * SEVERAL WHOLE months against periods that already exist. "One and a half months, twice" and
 * "two whole months" take different branches of the pass-1 loop, and only the first was pinned.
 *
 * €1,250 rather than the 950 above, because the scenario these were written from is a €2,500
 * transfer clearing two €1,250 months.
 */
describe("planAllocation — a payment covering several whole months", () => {
  const RENT_1250 = 1250;
  const month = (m: number, allocatedAmount = 0, dueAmount = RENT_1250): PeriodSnapshot =>
    period(2026, m, allocatedAmount, dueAmount);

  it("€2,500 against two open €1,250 months clears both in full", () => {
    const plan = planAllocation({
      payment: payment(2500),
      periods: [month(6), month(7)],
    });

    expect(plan.warnings).toEqual([]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.map((e) => e.amount)).toEqual([1250, 1250]);
    // Neither month may be typed "partial" — both are settled in full. The `partial` label is
    // what the UI and the period status key off, so a full month wearing it reads as arrears.
    expect(plan.entries.some((e) => e.type === "partial")).toBe(false);
  });

  it("types only the first month as rent; the rest are carried-forward credit", () => {
    const plan = planAllocation({
      payment: payment(2500),
      periods: [month(6), month(7)],
    });

    // engine.ts: only the first period touched carries the payment's intent. This is a
    // deliberate labelling decision — flipping it would relabel every carried month as "rent"
    // and lose the fact that one transfer paid for both.
    expect(plan.entries[0]).toMatchObject({ period: { month: 6 }, type: "rent" });
    expect(plan.entries[1]).toMatchObject({ period: { month: 7 }, type: "overpayment_credit" });
  });

  it("stops at the money, not at the period list — a third open month is untouched", () => {
    const plan = planAllocation({
      payment: payment(2500),
      periods: [month(5), month(6), month(7)],
    });

    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.map((e) => e.period.month)).toEqual([5, 6]);
    expect(plan.warnings).toEqual([]);
  });

  it("finishes a partly-paid oldest month first, then carries the rest forward", () => {
    // June already holds €400 of its €1,250. €2,500 must fill June's €850 remainder, clear July
    // whole, and leave €400 sitting against August. Existing cases exercise the remainder and
    // the carry-forward separately; this is the only one where the remainder FEEDS the carry,
    // which is where an off-by-one in the pass-1 loop would surface.
    const plan = planAllocation({
      payment: payment(2500),
      periods: [month(6, 400), month(7), month(8)],
    });

    expect(plan.entries).toEqual([
      { period: { year: 2026, month: 6, id: "p-2026-6" }, amount: 850, type: "rent" },
      {
        period: { year: 2026, month: 7, id: "p-2026-7" },
        amount: 1250,
        type: "overpayment_credit",
      },
      { period: { year: 2026, month: 8, id: "p-2026-8" }, amount: 400, type: "overpayment_credit" },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("leaves no float residue when the payment lands exactly on a period boundary", () => {
    // 1233.33 × 2 does not survive binary floating point cleanly. Without the half-cent epsilon
    // at the end of planAllocation, the sub-cent tail would be reported as unallocated money and
    // the landlord would see a horizon warning on a payment that balanced exactly.
    const due = 1233.33;
    const plan = planAllocation({
      payment: payment(due * 2),
      periods: [month(6, 0, due), month(7, 0, due)],
    });

    expect(plan.warnings).toEqual([]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.map((e) => e.amount)).toEqual([due, due]);
  });
});

describe("derivePeriodStatus", () => {
  const june = { dueDate: periodDueDate({ year: 2026, month: 6 }), dueAmount: RENT };

  it("fully allocated on time → paid; after due date → paid_late", () => {
    const today = new Date("2026-06-15");
    expect(
      derivePeriodStatus(
        { ...june, allocatedAmount: RENT, fullyPaidAt: new Date("2026-05-28") },
        today,
      ),
    ).toBe("paid");
    expect(
      derivePeriodStatus(
        { ...june, allocatedAmount: RENT, fullyPaidAt: new Date("2026-06-10") },
        today,
      ),
    ).toBe("paid_late");
  });

  it("unallocated: upcoming before due date, due on it, overdue after", () => {
    const base = { ...june, allocatedAmount: 0 };
    expect(derivePeriodStatus(base, new Date("2026-05-20"))).toBe("upcoming");
    expect(derivePeriodStatus(base, new Date(Date.UTC(2026, 5, 1)))).toBe("due");
    expect(derivePeriodStatus(base, new Date("2026-06-05"))).toBe("overdue");
  });

  it("partially allocated past due → partially_paid", () => {
    expect(derivePeriodStatus({ ...june, allocatedAmount: 400 }, new Date("2026-06-05"))).toBe(
      "partially_paid",
    );
  });
});

describe("deriveTenantStatus", () => {
  it("any overdue or partial period → overdue; open due → pending; else paid", () => {
    expect(deriveTenantStatus(["paid", "overdue", "upcoming"])).toBe("overdue");
    expect(deriveTenantStatus(["paid", "partially_paid"])).toBe("overdue");
    expect(deriveTenantStatus(["paid", "due", "upcoming"])).toBe("pending");
    expect(deriveTenantStatus(["paid", "paid_late", "upcoming"])).toBe("paid");
  });
});

describe("planAllocation — a payment that names its month", () => {
  it("fills the named month even when an older one is open", () => {
    const periods = [period(2026, 3), period(2026, 4), period(2026, 5)];
    const plan = planAllocation({
      payment: payment(RENT),
      periods,
      startAt: { year: 2026, month: 5 },
    });
    expect(plan.entries).toEqual([
      { period: { year: 2026, month: 5, id: "p-2026-5" }, amount: RENT, type: "rent" },
    ]);
  });

  it("carries what is left to the months after it, then back to older ones", () => {
    const periods = [period(2026, 3), period(2026, 4), period(2026, 5)];
    const plan = planAllocation({
      payment: payment(RENT * 3),
      periods,
      startAt: { year: 2026, month: 4 },
    });
    expect(plan.entries.map((e) => e.period.month)).toEqual([4, 5, 3]);
  });

  it("passes over a named month already paid, as the waterfall does", () => {
    const periods = [period(2026, 3), period(2026, 4, RENT)];
    const plan = planAllocation({
      payment: payment(RENT),
      periods,
      startAt: { year: 2026, month: 4 },
    });
    expect(plan.entries.map((e) => e.period.month)).toEqual([3]);
  });
});
