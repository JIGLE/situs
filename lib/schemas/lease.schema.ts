import { z } from "zod";

const dateOrderRefinement = (data: { startDate?: string; endDate?: string }) => {
  if (!data.startDate || !data.endDate) return true;
  return Date.parse(data.endDate) > Date.parse(data.startDate);
};
const dateOrderError = { message: "End date must be after start date", path: ["endDate"] };

/**
 * A lease's own terms, with no defaults.
 *
 * Defaults belong to creation only, so they are added below rather than here. Zod 4 still applies
 * a `.default()` inside `.partial()`: an update schema built from a defaulted base parsed
 * `{ monthlyRent: 800 }` as that rent plus `status: "draft"`, `deposit: 0`, `autoRenew: false` and
 * `renewalNoticeDays: 60`, resetting an active lease with every rent change.
 */
const leaseFields = z.object({
  tenantId: z.string().min(1, "Tenant is required"),
  propertyId: z.string().min(1, "Property is required"),
  unitId: z.string().optional(),
  startDate: z.string().refine((date) => !isNaN(Date.parse(date)), "Invalid start date"),
  endDate: z.string().refine((date) => !isNaN(Date.parse(date)), "Invalid end date"),
  monthlyRent: z.number().positive("Rent must be positive"),
  deposit: z.number().min(0, "Deposit cannot be negative"),
  // Spelled as the wizard's Select and the demo seed spell it; nullable because a lease created
  // without a regime stores null, and editing it sends that null back.
  taxRegime: z.enum(["portugal_rendimentos", "spain_inmuebles"]).nullish(),
  status: z.enum(["active", "expired", "terminated", "pending", "draft"]),
  autoRenew: z.boolean(),
  renewalNoticeDays: z.number().min(0).max(365),
  notes: z.string().max(1000, "Notes too long").optional(),
});

const leaseBaseSchema = leaseFields.extend({
  deposit: leaseFields.shape.deposit.default(0),
  status: leaseFields.shape.status.default("draft"),
  autoRenew: leaseFields.shape.autoRenew.default(false),
  renewalNoticeDays: leaseFields.shape.renewalNoticeDays.default(60),
});

export const leaseSchema = leaseBaseSchema.refine(dateOrderRefinement, dateOrderError);
export const createLeaseSchema = leaseBaseSchema
  .omit({ status: true })
  .refine(dateOrderRefinement, dateOrderError);
/** Only the terms a request sends, and nothing it doesn't: see `leaseFields`. */
export const updateLeaseSchema = leaseFields.partial().refine(dateOrderRefinement, dateOrderError);

export type Lease = z.infer<typeof leaseSchema>;
export type LeaseFormData = z.infer<typeof leaseSchema>;
export type CreateLease = z.infer<typeof createLeaseSchema>;
export type UpdateLease = z.infer<typeof updateLeaseSchema>;
