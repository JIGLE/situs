import { z } from "zod";

export const ownerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  email: z.string().email("Invalid email address").max(255, "Email too long"),
  phone: z.string().max(20, "Phone number too long").optional(),
  address: z.string().max(200, "Address too long").optional(),
  notes: z.string().max(500, "Notes too long").optional(),
});

export const createOwnerSchema = ownerSchema;

export type Owner = z.infer<typeof ownerSchema>;
export type OwnerFormData = z.infer<typeof ownerSchema>;
export type CreateOwner = z.infer<typeof createOwnerSchema>;
