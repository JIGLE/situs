import { z } from "zod";
import { checkTaxId, taxIdentityFields } from "./tax-identity";

const tenantFields = z.object({
  name: z.string().min(1, "Tenant name is required").max(100, "Name too long"),
  email: z.string().email("Invalid email format").max(255, "Email too long"),
  phone: z.string().max(20, "Phone number too long").optional().default(""),
  propertyId: z.string().optional(),
  rent: z.number().min(0, "Rent must be positive").optional().default(0),
  leaseStart: z
    .string()
    .optional()
    .refine((d) => !d || !isNaN(Date.parse(d)), "Invalid date")
    .default(""),
  leaseEnd: z
    .string()
    .optional()
    .refine((d) => !d || !isNaN(Date.parse(d)), "Invalid date")
    .default(""),
  paymentStatus: z.enum(["paid", "overdue", "pending"]).default("pending"),
  lastPayment: z.string().optional(),
  notes: z.string().max(1000, "Notes too long").optional(),
  ...taxIdentityFields,
});

export const tenantSchema = tenantFields.superRefine((data, ctx) => checkTaxId(data, ctx));

export const createTenantSchema = tenantFields
  .omit({ paymentStatus: true, lastPayment: true })
  .superRefine((data, ctx) => checkTaxId(data, ctx));

export type Tenant = z.infer<typeof tenantSchema>;
export type TenantFormData = z.infer<typeof tenantSchema>;
export type CreateTenant = z.infer<typeof createTenantSchema>;
