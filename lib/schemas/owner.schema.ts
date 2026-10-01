import { z } from "zod";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

const ownerFields = {
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  email: z.string().email("Invalid email address").max(255, "Email too long"),
  phone: z.string().max(20, "Phone number too long").optional(),
  address: z.string().max(200, "Address too long").optional(),
  notes: z.string().max(500, "Notes too long").optional(),
  // What AT names a landlord by on a receipt. Optional: an owner can be recorded before anyone has
  // the number to hand, and a blank input arrives as "", which means none. Null is accepted too,
  // since a record read back from the API carries null for an empty column and an edit form that
  // loads a record as it is must still validate.
  taxIdentificationNumber: z.string().trim().max(30, "Tax number too long").nullish(),
};

/** A NIF, when there is one, must pass its check digit. The API stores it as its nine digits. */
function checkNif(data: { taxIdentificationNumber?: string | null }, ctx: z.RefinementCtx): void {
  const nif = data.taxIdentificationNumber;
  if (nif && !validatePortugueseNIF(nif)) {
    ctx.addIssue({ code: "custom", path: ["taxIdentificationNumber"], message: "Invalid NIF" });
  }
}

export const ownerSchema = z.object(ownerFields).superRefine(checkNif);

/** An edit sends only what it changes. */
export const updateOwnerSchema = z.object(ownerFields).partial().superRefine(checkNif);

export const createOwnerSchema = ownerSchema;

export type Owner = z.infer<typeof ownerSchema>;
export type OwnerFormData = z.infer<typeof ownerSchema>;
export type CreateOwner = z.infer<typeof createOwnerSchema>;
