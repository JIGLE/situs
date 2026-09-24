import { describe, expect, it } from "vitest";
import { rentPeriodStatusKey } from "./rent-period-labels";

describe("rentPeriodStatusKey", () => {
  it("keys every status a period can be shown with, waived included", () => {
    for (const status of [
      "upcoming",
      "due",
      "overdue",
      "partially_paid",
      "paid",
      "paid_late",
      "waived",
    ]) {
      expect(rentPeriodStatusKey(status)).toBe(status);
    }
  });

  it("returns nothing for a status it does not know, however it is spelled", () => {
    expect(rentPeriodStatusKey("cancelled")).toBeUndefined();
    expect(rentPeriodStatusKey("toString")).toBeUndefined();
    expect(rentPeriodStatusKey(undefined)).toBeUndefined();
  });
});
