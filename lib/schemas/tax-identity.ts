import { z } from "zod";
import { validatePortugueseNIF } from "@/lib/utils/tax-id-validation";

/**
 * How AT names a person on a contract or a receipt: a NIF, or, for someone with no Portuguese
 * NIF, an identity document and the country that issued it. Shared by tenants and a lease's
 * other parties (co-tenants and guarantors).
 *
 * Every field is optional: a lease can be recorded before anyone has the numbers to hand. A blank
 * input arrives as "", which means none. Null is accepted too, and means the same: a record read
 * back from the API carries null for an empty column, and an edit form that loads a record as it
 * is must still validate.
 */
export const taxIdentityFields = {
  taxId: z.string().trim().max(30, "Tax number too long").nullish(),
  taxCountry: z
    .string()
    .regex(/^[A-Z]{2}$/, "Invalid country")
    .nullish(),
  idDocument: z.string().trim().max(50, "Document number too long").nullish(),
};

interface TaxIdentity {
  taxId?: string | null;
  taxCountry?: string | null;
}

/**
 * A Portuguese NIF must pass its check digit; another country's tax number is not checked. With
 * no country the NIF is taken as Portuguese, the column's default.
 *
 * `country` is for an update that sends a NIF without the country the record already has.
 */
export function checkTaxId(
  data: TaxIdentity,
  ctx: z.RefinementCtx,
  country: string | null | undefined = data.taxCountry,
): void {
  if (!data.taxId) return;
  if ((country || "PT") === "PT" && !validatePortugueseNIF(data.taxId)) {
    ctx.addIssue({ code: "custom", path: ["taxId"], message: "Invalid NIF" });
  }
}

/**
 * The value to store: null for a blank input, a Portuguese NIF as its nine digits (AT wants an
 * integer, and "123 456 789" is the same number), anything else trimmed.
 */
export function normalizeTaxId(
  taxId: string | null | undefined,
  country: string | null | undefined,
): string | null | undefined {
  if (taxId === undefined || taxId === null) return taxId;
  const trimmed = taxId.trim();
  if (!trimmed) return null;
  return (country || "PT") === "PT" ? trimmed.replace(/\D/g, "") : trimmed;
}

/** A blank input as null, so an update can clear the field; undefined leaves it alone. */
export function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
