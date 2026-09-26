"use client";

import { useMemo } from "react";
import { Info, KeyRound, MonitorSmartphone, Shield } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { UserSettings } from "./settings-types";

interface SettingsAccountProps {
  appVersion: string;
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

/**
 * Identity and account-level records.
 *
 * Sessions, API tokens and the audit trail came from the standalone `/account` page, which was
 * otherwise a read-only shadow of this screen — its Security card showed the 2FA state and then
 * linked here for the control. Appearance and the GDPR export/delete controls moved out to their
 * own sections, so this one has a single subject.
 *
 * The country of tax residence is the one field here that is saved, with the page's Guardar. The
 * rail shows it under the owner's name, after the language.
 */
export function SettingsAccount({ appVersion, settings, updateSetting }: SettingsAccountProps) {
  const { data: session } = useSession();
  const t = useTranslations("settings.panel");
  const tStatus = useTranslations("status");
  const locale = useLocale();
  const countries = useMemo(() => countryOptions(locale), [locale]);

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
          {appVersion && (
            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                <span>{t("version", { version: appVersion })}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5" />
            {t("sessions")}
          </CardTitle>
          <CardDescription>{t("sessionsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* A divided row, not a bordered box. This was a card inside a card — the panel already
              draws a border, so framing the one row inside it again drew two rectangles around a
              single fact. A rule above the row separates it from the description just as well and
              costs no nesting; it is the same divided-list pattern `system-status-view.tsx` uses
              for a list of exactly this shape. */}
          <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] py-3">
            <div>
              <p className="text-sm font-medium">{t("thisDevice")}</p>
              <p className="mono-label mt-1">{t("currentSession")}</p>
            </div>
            <Badge variant="status-success">{tStatus("active")}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t("sessionsSoon")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t("apiTokens")}
          </CardTitle>
          <CardDescription>{t("apiTokensDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("noTokens")}</p>
        </CardContent>
      </Card>

      <div>
        <p className="mono-label mb-2">{t("activity")}</p>
        <AuditTrail emptyDescription={t("activityEmpty")} />
      </div>
    </div>
  );
}

export default SettingsAccount;
