export interface UserSettings {
  theme: "normal" | "dark" | "system";
  language: string;
  emailNotifications: boolean;
  taxReminderNotifications: boolean;
  distributionNotifications: boolean;
}

export const defaultSettings: UserSettings = {
  theme: "system",
  language: "en",
  emailNotifications: true,
  taxReminderNotifications: true,
  distributionNotifications: true,
};
