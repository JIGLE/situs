import { z } from "zod";

/**
 * A receipt's own fields, with no defaults. The `paid` default is added for creation only: Zod 4
 * still applies a `.default()` inside `.partial()`, so an update schema built from a defaulted
 * base marked a pending receipt paid whenever an edit left `status` out.
 */
const receiptFields = z.object({
  tenantId: z.string().min(1, "Tenant is required"),
  propertyId: z.string().min(1, "Property is required"),
  leaseId: z.string().optional(),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  date: z.string().refine((date) => !isNaN(Date.parse(date)), "Invalid date"),
  type: z.enum(["rent", "deposit", "maintenance", "other"]),
  status: z.enum(["paid", "pending"]),
  description: z.string().max(500, "Description too long").optional(),
});

export const receiptSchema = receiptFields.extend({
  status: receiptFields.shape.status.default("paid"),
});

export const createReceiptSchema = receiptSchema;
/** Only the fields a request sends: see `receiptFields`. */
export const updateReceiptSchema = receiptFields.partial();

export type Receipt = z.infer<typeof receiptSchema>;
export type ReceiptFormData = z.infer<typeof receiptSchema>;
export type CreateReceipt = z.infer<typeof createReceiptSchema>;
export type UpdateReceipt = z.infer<typeof updateReceiptSchema>;

// Situs receipt lifecycle (Migration C) — see lib/services/receipts/lifecycle.ts
// for the state machine this validates against.
export const receiptLifecycleTransitionSchema = z.object({
  to: z.enum(["draft", "review", "emitted", "submitted", "accepted", "rejected", "voided"]),
  voidReason: z.string().max(500).optional(),
});

export type ReceiptLifecycleTransitionInput = z.infer<typeof receiptLifecycleTransitionSchema>;
