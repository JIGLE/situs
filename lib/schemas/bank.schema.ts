import { z } from "zod";

/** One bank movement — a `BankRow` (lib/services/bank/rows.ts). */
export const bankRowSchema = z.object({
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bookingDate must be YYYY-MM-DD"),
  valueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  amount: z
    .number()
    .finite()
    .refine((v) => v !== 0, "amount cannot be zero"),
  counterpartyName: z.string().max(200).optional(),
  counterpartyIban: z.string().max(50).optional(),
  reference: z.string().max(500).optional(),
});

/** POST /api/debug/bank/movements — movements to import, in development and E2E only. */
export const debugBankMovementsSchema = z.object({
  rows: z.array(bankRowSchema).min(1).max(1000),
});

/** PUT /api/bank/transactions/[id] — inbox row actions; `restore` takes an ignored one back. */
export const bankTransactionActionSchema = z
  .object({
    action: z.enum(["confirm", "reassign", "ignore", "restore"]),
    leaseId: z.string().optional(),
  })
  .refine((body) => body.action !== "reassign" || !!body.leaseId, {
    message: "reassign requires a leaseId",
  });

export type BankTransactionActionInput = z.infer<typeof bankTransactionActionSchema>;

/**
 * POST /api/bank/connections/connect — begin a live bank connection.
 *
 * `institutionName` is display-only and comes from the picker the client just rendered, so it is
 * length-bounded rather than trusted: it is written to a column that is shown back to the user,
 * never used to resolve anything.
 */
export const bankConnectSchema = z.object({
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "country must be a 2-letter ISO code")
    .transform((v) => v.toUpperCase()),
  institutionId: z.string().min(1).max(120),
  institutionName: z.string().min(1).max(200),
  // Which provider to consent through. Validated against the instance's configured set in
  // `startConsent`, never trusted from the body — this only bounds the shape.
  providerKey: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/i, "providerKey must be alphanumeric"),
  // Marks the resulting connection as a deliberate test run. It changes nothing about the
  // consent — same provider, same flow, same code path, which is the entire point of testing
  // with it — only how the connection is labelled and that it can be deleted from /admin.
  isTest: z.boolean().optional(),
});

export type BankConnectInput = z.infer<typeof bankConnectSchema>;
