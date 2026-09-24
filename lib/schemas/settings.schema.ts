import { z } from "zod";

/**
 * `POST /api/settings`. Every field is optional and none has a default: the onboarding checklist
 * sends one field, and must not reset the rest.
 *
 * `theme` and `language` are checked as strings, not against today's option lists. The settings
 * form posts back the row it loaded, so a value an older version stored ("light", "dark-oled")
 * has to keep saving; `normalizeMode` in `lib/contexts/theme-context.tsx` reads those.
 */
export const updateSettingsSchema = z
  .object({
    theme: z.string().trim().max(20),
    language: z.string().trim().max(10),
    emailNotifications: z.boolean(),
    taxReminderNotifications: z.boolean(),
    distributionNotifications: z.boolean(),
    onboardingDismissedAt: z.iso.datetime().nullable(),
  })
  .partial();
