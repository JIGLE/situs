import { describe, it, expect } from "vitest";
import { leaseSchema, updateLeaseSchema } from "./lease.schema";

const lease = {
  tenantId: "tenant-1",
  propertyId: "prop-1",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  monthlyRent: 950,
};

describe("lease schema: tax regime", () => {
  // The wizard's Select, the demo seed and the tax calculator all say `portugal_rendimentos`; the
  // schema said `portugal_rendamentos`. Choosing the Portuguese regime made a lease impossible to
  // save: the wizard's final check failed on a value the wizard itself had written.
  it("accepts the Portuguese regime as the rest of the app spells it", () => {
    expect(leaseSchema.safeParse({ ...lease, taxRegime: "portugal_rendimentos" }).success).toBe(
      true,
    );
  });

  // `Lease.taxRegime` is nullable and a lease created without one stores null. Editing such a
  // lease loads that null into the form, and the schema refused it — so the edit could not be
  // saved either.
  it("accepts a lease with no regime, as it is stored", () => {
    expect(leaseSchema.safeParse({ ...lease, taxRegime: null }).success).toBe(true);
  });
});

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
