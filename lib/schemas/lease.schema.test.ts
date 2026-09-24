import { describe, it, expect } from "vitest";
import { updateLeaseSchema } from "./lease.schema";

describe("lease schema: updates", () => {
  // Zod 4 still applies a `.default()` inside `.partial()`. Built that way, this rent change came
  // back with `status: "draft"`, `deposit: 0`, `autoRenew: false` and `renewalNoticeDays: 60`.
  it("adds nothing a partial update did not send", () => {
    expect(updateLeaseSchema.parse({ monthlyRent: 800 })).toEqual({ monthlyRent: 800 });
  });

  it("still refuses an end date before the start date", () => {
    expect(
      updateLeaseSchema.safeParse({ startDate: "2027-01-01", endDate: "2026-01-01" }).success,
    ).toBe(false);
  });
});
