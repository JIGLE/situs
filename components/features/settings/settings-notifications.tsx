"use client";

import { useTranslations } from "next-intl";
import { Panel } from "@/components/shared/panel";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { UserSettings } from "./settings-types";

interface SettingsNotificationsProps {
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

/**
 * The e-mails the owner gets. Each switch is named by its label (`htmlFor`), so a screen reader
 * announces what it turns on; they were anonymous switches.
 *
 * "Income distribution alerts" went: nothing reads `distributionNotifications`, so the switch
 * changed nothing. The column stays, as the settings API still accepts it.
 */
const SWITCHES = [
  { key: "emailNotifications", label: "allEmail", help: "allEmailHelp" },
  { key: "taxReminderNotifications", label: "taxYearReminders", help: "taxYearRemindersHelp" },
] as const;

export function SettingsNotifications({ settings, updateSetting }: SettingsNotificationsProps) {
  const t = useTranslations("settings.panel");
  return (
    <Panel title={t("emailNotifications")} bodyClassName="space-y-6 p-4">
      {SWITCHES.map((item) => {
        const id = `settings-${item.key}`;
        return (
          <div key={item.key} className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={id}>{t(item.label)}</Label>
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {t(item.help)}
              </p>
            </div>
            <Switch
              id={id}
              aria-describedby={`${id}-help`}
              checked={settings[item.key]}
              onCheckedChange={(checked) => updateSetting(item.key, checked)}
            />
          </div>
        );
      })}
    </Panel>
  );
}

export default SettingsNotifications;
