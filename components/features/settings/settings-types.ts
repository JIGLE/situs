/**
 * The Settings form's fields, saved together by its Guardar button (`POST /api/settings`).
 *
 * The language is not one of them. Settings › Appearance switches it at once through
 * `useSetLanguage`, and `POST /api/settings` ignores it: posting back the row the form loaded would
 * record whatever the row held as the owner's choice.
 */
export interface UserSettings {
  theme: "normal" | "dark" | "system";
  /** ISO 3166-1 alpha-2: the country of tax residence, shown under the owner's name in the rail. */
  residenceCountry: string;
  emailNotifications: boolean;
  taxReminderNotifications: boolean;
  distributionNotifications: boolean;
}

export const defaultSettings: UserSettings = {
  theme: "system",
  residenceCountry: "PT",
  emailNotifications: true,
  taxReminderNotifications: true,
  distributionNotifications: true,
};
