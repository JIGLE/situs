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

export type AtCredentialsInput = z.infer<typeof atCredentialsSchema>;
export type AtSelectableMode = (typeof AT_SELECTABLE_MODES)[number];
