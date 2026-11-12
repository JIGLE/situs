"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Panel } from "@/components/shared/panel";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countryOptions } from "@/lib/utils/countries";
import type { UserSettings } from "./settings-types";

interface SettingsAccountProps {
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

/**
 * Who the account is: the e-mail and name it signed in with, and the country of tax residence.
 *
 * The section it opens also holds Appearance, the account's other preferences. The version and the
 * legal links sit at the foot of Settings' own section list; the activity is under My data.
 */
export function SettingsAccount({ settings, updateSetting }: SettingsAccountProps) {
  const { data: session } = useSession();
  const t = useTranslations("settings.panel");
  const locale = useLocale();
  const countries = useMemo(() => countryOptions(locale), [locale]);

  return (
    <div className="space-y-6">
      <Panel title={t("accountInfo")} padded>
        <div className="space-y-1">
          <Label>{t("email")}</Label>
          <p className="text-sm text-muted-foreground">
            {session?.user?.email || t("notAvailable")}
          </p>
        </div>
        <div className="space-y-1">
          <Label>{t("name")}</Label>
          <p className="text-sm text-muted-foreground">{session?.user?.name || t("notSet")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-residence-country">{t("residenceCountry")}</Label>
          <Select
            value={settings.residenceCountry}
            onValueChange={(code) => updateSetting("residenceCountry", code)}
          >
            <SelectTrigger
              id="settings-residence-country"
              className="max-w-xs"
              aria-describedby="settings-residence-country-help"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {countries.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="settings-residence-country-help" className="text-xs text-muted-foreground">
            {t("residenceCountryHelp")}
          </p>
        </div>
      </Panel>
    </div>
  );
}

export default SettingsAccount;
