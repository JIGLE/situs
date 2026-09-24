"use client";

import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserSettings } from "./settings-types";

/** Codes only — the display names resolve against `settings.panel` at render, since country
 *  and currency names differ per locale ("Spain" / "España" / "Spagna"). */
const CURRENCIES = ["EUR", "DKK", "USD", "GBP"] as const;
const TAX_COUNTRIES = ["PT", "ES", "DK"] as const;

interface SettingsTaxProps {
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

export function SettingsTax({ settings, updateSetting }: SettingsTaxProps) {
  const t = useTranslations("settings.panel");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("regional")}
          </CardTitle>
          <CardDescription>{t("regionalDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm space-y-4">
          <div className="space-y-2">
            <Label>{t("defaultCurrency")}</Label>
            <Select
              value={settings.defaultCurrency}
              onValueChange={(value) =>
                updateSetting("defaultCurrency", value as UserSettings["defaultCurrency"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectCurrency")} />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`currency${code}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("defaultTaxCountry")}</Label>
            <Select
              value={settings.defaultTaxCountry || ""}
              onValueChange={(value) => updateSetting("defaultTaxCountry", value || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("selectCountry")} />
              </SelectTrigger>
              <SelectContent>
                {TAX_COUNTRIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`country${code}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("taxCountryHelp")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SettingsTax;
