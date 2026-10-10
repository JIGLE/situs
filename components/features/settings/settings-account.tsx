"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Info, Shield } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuditTrail } from "@/components/shared/audit-trail";
import { countryOptions } from "@/lib/utils/countries";
import { cn } from "@/lib/utils/utils";
import type { UserSettings } from "./settings-types";
import { LegalLinks } from "@/components/shared/legal-links";

interface SettingsAccountProps {
  appVersion: string;
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

/**
 * Identity and account-level records.
 *
 * The audit trail came from the standalone `/account` page, which was otherwise a read-only
 * shadow of this screen. Two cards came with it, Sessions and API tokens, and went: both were
 * placeholders for features that do not exist, one of them a hard-coded "this device, active" row.
 * Appearance and the GDPR export/delete controls moved out to their own sections, so this one has
 * a single subject.
 *
 * The country of tax residence is the one field here that is saved, with the page's Guardar. The
 * rail shows it under the owner's name, after the language.
 *
 * The activity starts closed and is fetched only when opened: it is a record to consult, and it
 * was loaded every time Account opened. A closed `<details>` would still mount it and fetch.
 */
export function SettingsAccount({ appVersion, settings, updateSetting }: SettingsAccountProps) {
  const { data: session } = useSession();
  const t = useTranslations("settings.panel");
  const locale = useLocale();
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t("accountInfo")}
          </CardTitle>
          <CardDescription>{t("accountInfoDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <div className="pt-4 border-t border-border space-y-2">
            {appVersion && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                <span>{t("version", { version: appVersion })}</span>
              </div>
            )}
            <LegalLinks className="justify-start" />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={activityOpen}
          onClick={() => setActivityOpen((open) => !open)}
          className="-ml-3 gap-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ChevronRight
            aria-hidden
            className={cn("h-4 w-4 transition-transform", activityOpen && "rotate-90")}
          />
          {t("activity")}
        </Button>
        {activityOpen && <AuditTrail emptyDescription={t("activityEmpty")} />}
      </div>
    </div>
  );
}

export default SettingsAccount;
