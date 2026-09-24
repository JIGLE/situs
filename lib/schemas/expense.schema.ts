import { z } from "zod";

// ─── Expense Categories ──────────────────────────────────────────────────────
// IRS deductibility (Category F) is indicated by the DEDUCTIBLE_CATEGORIES set below.

export const EXPENSE_CATEGORIES = [
  // Property taxes
  "imi", // PT: Imposto Municipal sobre Imóveis
  "stamp_duty", // Stamp duty / Imposto de Selo
  "other_tax", // Other property-related taxes
  // Insurance
  "building_insurance", // Building / structure insurance
  "contents_insurance", // Contents / fixtures insurance
  "liability_insurance", // Landlord liability insurance
  // Common / building expenses
  "condominium_fees", // Condominium / HOA monthly fees
  "stair_lighting", // Common area lighting
  "cleaning", // Cleaning services (common areas or unit)
  "gardening", // Garden / landscaping
  "elevator", // Elevator maintenance contract
  "security", // Security services
  // Maintenance & repairs
  "repairs", // General repairs
  "maintenance", // Preventive / scheduled maintenance
  "appliances", // Appliance repair or replacement
  // Utilities (when paid by landlord)
  "water",
  "electricity",
  "gas",
  "internet",
  "utilities", // Generic utilities (backward compat)
  // Financial / administrative
  "mortgage_interest", // Mortgage interest payments
  "management_fees", // Property management company fees
  "legal_fees", // Legal costs (lease drafting, disputes)
  "accountant_fees", // Tax advisor / TOC / gestor fees
  // Instance / tooling — the cost of running this software, recorded as an expense so it flows
  // through the same pipeline and reaches reports beside property costs. Deliberately absent from
  // DEDUCTIBLE_CATEGORIES below: whether self-hosting is deductible against PT Categoria F or ES
  // Rendimientos del Capital Inmobiliario is a question for a TOC/gestor, not for this file, and
  // `isDeductible` is per-expense and editable when the answer is yes.
  "software_hosting",
  // Fallback
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Categories that are generally deductible for IRS Categoria F.
 * This is indicative — always confirm with a certified accountant (TOC).
 */
export const DEDUCTIBLE_CATEGORIES = new Set<ExpenseCategory>([
  "imi",
  "building_insurance",
  "contents_insurance",
  "liability_insurance",
  "condominium_fees",
  "repairs",
  "maintenance",
  "appliances",
  "mortgage_interest",
  "management_fees",
  "legal_fees",
  "accountant_fees",
  "cleaning",
  "gardening",
  "elevator",
  "security",
  "utilities",
  "water",
  "electricity",
  "gas",
  "internet",
]);

export function isDefaultDeductible(category: ExpenseCategory): boolean {
  return DEDUCTIBLE_CATEGORIES.has(category);
}

// ─── Recurrence Rules ────────────────────────────────────────────────────────

export const RECURRENCE_RULES = ["monthly", "quarterly", "annual"] as const;
export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

// ─── Schema ──────────────────────────────────────────────────────────────────

export const expenseSchema = z.object({
  propertyId: z.string().min(1, "Property is required"),
  unitId: z.string().cuid().optional().nullable(),
  leaseId: z.string().cuid().optional().nullable(),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), "Invalid date"),
  category: z.enum(EXPENSE_CATEGORIES, { error: "Invalid category" }),
  description: z.string().max(500, "Description too long").optional(),
  isDeductible: z.boolean().default(true),
  vendorName: z.string().max(150, "Vendor name too long").optional(),
  vendorVat: z.string().max(20, "VAT/NIF too long").optional(),
  documentId: z.string().optional().nullable(),
  // Recurring expense fields (Wave 2.4)
  isRecurring: z.boolean().default(false).optional(),
  recurrenceRule: z.enum(RECURRENCE_RULES).optional(),
  recurrenceDay: z.number().int().min(1).max(28).optional(),
  recurrenceEnd: z.string().optional().nullable(),
});

export const createExpenseSchema = expenseSchema;

export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseFormData = z.infer<typeof expenseSchema>;
export type CreateExpense = z.infer<typeof createExpenseSchema>;
