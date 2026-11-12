import { z } from "zod";

/**
 * A payout to a co-owner: money handed over from the rent the account collected, counted against
 * one year's share (`lib/services/owner-payouts/`).
 */
export const ownerPayoutSchema = z.object({
  ownerId: z.string().min(1, "Owner is required"),
  year: z.number().int().min(2000).max(2100),
  amount: z
    .number({ message: "Amount must be a number" })
    .gt(0, "Amount must be greater than 0")
    .lte(10_000_000, "Amount is too large"),
  /** The day the money was handed over (YYYY-MM-DD). */
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31"),
  note: z.string().max(500).nullish(),
});

export type OwnerPayoutInput = z.infer<typeof ownerPayoutSchema>;

/** Marks or unmarks the owner who collects the rent and keeps their share of it. */
export const rentCollectorSchema = z.object({
  ownerId: z.string().min(1, "Owner is required"),
  collects: z.boolean(),
});
