import { describe, expect, it } from "vitest";
import { monthsBetween, plannedMonths } from "./rent-history-plan";

describe("monthsBetween", () => {
  it("counts across a year end", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("plannedMonths", () => {
  const open = [
    { month: "2026-09", outstanding: 850 },
    { month: "2026-10", outstanding: 850 },
  ];

  it("fills the oldest month owing first, then the months ahead", () => {
    expect(plannedMonths(open, [850, 850, 850], 850, "2026-09")).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("lets a double payment cover two months", () => {
    expect(plannedMonths(open, [1700, 850], 850, "2026-09")).toEqual(["2026-09", "2026-11"]);
  });

  it("starts at the tracked month when nothing is owed yet", () => {
    expect(plannedMonths([], [850], 850, "2026-11")).toEqual(["2026-11"]);
  });
});
