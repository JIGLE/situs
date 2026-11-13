import { z } from "zod";
import { EXPENSE_CATEGORIES } from "./expense.schema";

/**
 * A building's shared expense as the building sheet sends it: the cost, and the units that share
 * it (`lib/services/buildings/expenses.ts`). The fields are an expense's, less what belongs to one
 * property (a lease, who paid it, a repeat).
 */
export const buildingExpenseSchema = z.object({
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), "Invalid date"),
  category: z.enum(EXPENSE_CATEGORIES, { error: "Invalid category" }),
  description: z.string().max(500, "Description too long").nullish(),
  isDeductible: z.boolean().default(true),
  vendorName: z.string().max(150, "Vendor name too long").nullish(),
  vendorVat: z.string().max(20, "VAT/NIF too long").nullish(),
  /** The units that share it; each must be in the building. */
  propertyIds: z.array(z.string().min(1)).min(1, "Choose at least one unit").max(500),
});

export type BuildingExpenseInput = z.infer<typeof buildingExpenseSchema>;

/** `PUT /api/buildings/[id]/properties`: the building's units, all of them, and their permilagens. */
export const buildingUnitsSchema = z.object({
  units: z
    .array(
      z.object({
        propertyId: z.string().min(1),
        permilage: z.number().gt(0).max(1000).nullish(),
      }),
    )
    .max(500),
});

export type BuildingUnitsInput = z.infer<typeof buildingUnitsSchema>;
