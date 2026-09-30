import { z } from "zod";
import { AT_USERNAME } from "@/lib/tax/at/username";

/**
 * PUT /api/tax/connectors/at/credentials: the Portal sub-user Situs signs in to AT as.
 *
 * The password is optional so the username can be corrected without retyping it; the service
 * refuses a first save without one.
 */
export const atCredentialsSchema = z.object({
  username: z.string().trim().regex(AT_USERNAME, "username must be <NIF>/<sub-user>"),
  password: z.string().min(1).max(256).optional(),
});

/** The modes an owner may choose. `live` is not one: going live is a code change, not a choice. */
export const AT_SELECTABLE_MODES = ["sandbox", "review", "test"] as const;

/** PUT /api/tax/connectors/at/mode */
export const atModeSchema = z.object({ mode: z.enum(AT_SELECTABLE_MODES) });

/** AT's numbers are `long` in the WSDL; anything a JavaScript number holds exactly will do. */
const atNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** POST /api/tax/connectors/at/receipt: which receipt to fetch from AT. */
export const atReceiptSchema = z.object({ contractNumber: atNumber, receiptNumber: atNumber });

const receiptIds = (max: number) => z.array(z.string().min(1).max(64)).min(1).max(max);

/** POST /api/tax/connectors/at/receipts/preview: the receipts to review before issuing. */
export const atReceiptsPreviewSchema = z.object({ receiptIds: receiptIds(100) });

/**
 * POST /api/tax/connectors/at/receipts/test: the receipts to send to AT's test service. Fewer than
 * a review takes: each month is a call to AT, and the service stops at twelve months anyway.
 */
export const atReceiptsTestSchema = z.object({ receiptIds: receiptIds(12) });

export type AtCredentialsInput = z.infer<typeof atCredentialsSchema>;
export type AtSelectableMode = (typeof AT_SELECTABLE_MODES)[number];
