import { z } from "zod";
import { COUNTRY_CODES } from "@/lib/utils/countries";

/**
 * `POST /api/settings`. Every field is optional and none has a default: the onboarding checklist
 * sends one field, and must not reset the rest.
 *
 * `theme` is checked as a string, not against today's option list. The settings form posts back
 * the row it loaded, so a value an older version stored ("light", "dark-oled") has to keep saving;
 * `normalizeMode` in `lib/contexts/theme-context.tsx` reads those.
 *
 * `language` is not here: the form posts back the row it loaded, so it would write whatever the
 * row held and record that as the owner's choice. `PUT /api/settings/language` is its one writer.
 * An unknown key is dropped rather than refused, so a form that still sends it keeps saving.
 */
export const updateSettingsSchema = z
  .object({
    theme: z.string().trim().max(20),
    residenceCountry: z
      .string()
      .trim()
      .toUpperCase()
      .refine((code) => COUNTRY_CODES.includes(code), "Unknown country code"),
    emailNotifications: z.boolean(),
    taxReminderNotifications: z.boolean(),
    distributionNotifications: z.boolean(),
    onboardingDismissedAt: z.iso.datetime().nullable(),
  })
  .partial();
