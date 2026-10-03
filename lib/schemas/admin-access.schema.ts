import { z } from "zod";

/** PUT /api/admin/access/settings — one or both sign-up switches, and nothing else. */
export const signUpSettingsSchema = z
  .object({
    googleSignUp: z.boolean().optional(),
    invitations: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.googleSignUp !== undefined || body.invitations !== undefined, {
    message: "Say which switch to change",
  });

/**
 * POST /api/admin/access/invitations — an email, and the role it is invited as. A USER is no role to
 * invite: the owner routes refuse it, so the person would be admitted and then turned away.
 */
export const invitationSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email("Invalid email address"),
    role: z.enum(["ADMIN", "MANAGER"]),
  })
  .strict();
