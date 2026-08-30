import { z } from "zod";

export const tenantSchema = z.object({
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
  /** "" is the form's Auto option: derive the language from the property's country. */
  locale: z.enum(["pt", "es", "en", "it"]).or(z.literal("")).optional(),
});

export const createTenantSchema = tenantSchema.omit({
  paymentStatus: true,
  lastPayment: true,
});

export const updateTenantSchema = tenantSchema.partial();

export type Tenant = z.infer<typeof tenantSchema>;
export type TenantFormData = z.infer<typeof tenantSchema>;
export type CreateTenant = z.infer<typeof createTenantSchema>;
export type UpdateTenant = z.infer<typeof updateTenantSchema>;
