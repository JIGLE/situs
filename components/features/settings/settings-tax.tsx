"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Globe, Landmark, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/lib/contexts/toast-context";
import { httpError, useApiError } from "@/lib/utils/api-error";
import { useCsrf } from "@/lib/contexts/csrf-context";
import type { UserSettings } from "./settings-types";

interface FiscalProfile {
  fiscalResidency: string | null;
  nhrStatus: boolean;
  nhrYear: number | null;
  ificiStatus: boolean;
  ificiYear: number | null;
}

const defaultFiscalProfile: FiscalProfile = {
  fiscalResidency: null,
  nhrStatus: false,
  nhrYear: null,
  ificiStatus: false,
  ificiYear: null,
};

/** Codes only — the display names resolve against `settings.panel` at render, since country
 *  and currency names differ per locale ("Spain" / "España" / "Spagna"). */
const CURRENCIES = ["EUR", "DKK", "USD", "GBP"] as const;
const TAX_COUNTRIES = ["PT", "ES", "DK"] as const;
const FISCAL_RESIDENCIES = ["PT", "ES", "FR", "DE", "IT", "GB", "OTHER"] as const;

interface SettingsTaxProps {
  settings: UserSettings;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

export function SettingsTax({ settings, updateSetting }: SettingsTaxProps) {
  const t = useTranslations("settings.panel");
  const tSettings = useTranslations("settings");
  const { success, error: showError } = useToast();
  const resolveError = useApiError();
  const { token: csrfToken } = useCsrf();

  const [fiscalProfile, setFiscalProfile] = useState<FiscalProfile>(defaultFiscalProfile);
  const [fiscalLoading, setFiscalLoading] = useState(true);
  const [fiscalSaving, setFiscalSaving] = useState(false);
  const [fiscalHasChanges, setFiscalHasChanges] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/user/fiscal-profile");
        if (response.ok) {
          const data = await response.json();
          if (data.data) {
            setFiscalProfile({ ...defaultFiscalProfile, ...data.data });
          }
        }
      } catch (err) {
        console.error("Failed to load fiscal profile:", err);
      } finally {
        setFiscalLoading(false);
      }
    })();
  }, []);

  const updateFiscalProfile = <K extends keyof FiscalProfile>(key: K, value: FiscalProfile[K]) => {
    setFiscalProfile((prev) => {
      const next: FiscalProfile = { ...prev, [key]: value };
      // Mutual exclusivity: toggling one disables the other
      if (key === "nhrStatus" && value === true) {
        next.ificiStatus = false;
        next.ificiYear = null;
      }
      if (key === "ificiStatus" && value === true) {
        next.nhrStatus = false;
        next.nhrYear = null;
      }
      // Clear year when status disabled
      if (key === "nhrStatus" && value === false) {
        next.nhrYear = null;
      }
      if (key === "ificiStatus" && value === false) {
        next.ificiYear = null;
      }
      return next;
    });
    setFiscalHasChanges(true);
  };

  const saveFiscalProfile = async () => {
    setFiscalSaving(true);
    try {
      const response = await fetch("/api/user/fiscal-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken || "" },
        body: JSON.stringify(fiscalProfile),
      });

      if (response.ok) {
        success(t("toastTaxSaved"));
        setFiscalHasChanges(false);
      } else {
        // The route's `error` field is English written for a log, and the fallback was English too.
        showError(resolveError(httpError(response.status)));
      }
    } catch (err) {
      showError(resolveError(err));
    } finally {
      setFiscalSaving(false);
    }
  };

  const isPortugal = fiscalProfile.fiscalResidency === "PT";

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Tax &amp; Fiscal Profile
          </CardTitle>
          <CardDescription>
            Your personal tax residency and special regime status — used to calculate the correct
            tax rules on your rental income.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-lg space-y-6">
          {fiscalLoading ? (
            <div className="flex items-center justify-center h-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <>
              {/* Fiscal Residency */}
              <div className="space-y-2">
                <Label htmlFor="fiscal-residency">{tSettings("fiscalResidency")}</Label>
                <Select
                  value={fiscalProfile.fiscalResidency ?? ""}
                  onValueChange={(v) => updateFiscalProfile("fiscalResidency", v || null)}
                >
                  <SelectTrigger id="fiscal-residency" className="max-w-xs">
                    <SelectValue placeholder={t("selectCountry")} />
                  </SelectTrigger>
                  <SelectContent>
                    {FISCAL_RESIDENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {t(`country${code}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  The country where you are tax resident — determines which tax rules apply to your
                  rental income.
                </p>
              </div>

              {/* NHR Status — Portugal only */}
              {isPortugal && (
                <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <Label htmlFor="nhr-status">{tSettings("nhrStatus")}</Label>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {tSettings("nhrStatusHelp")}
                      </p>
                    </div>
                    <Switch
                      id="nhr-status"
                      checked={fiscalProfile.nhrStatus}
                      onCheckedChange={(v) => updateFiscalProfile("nhrStatus", v)}
                      disabled={fiscalProfile.ificiStatus}
                    />
                  </div>
                  {fiscalProfile.nhrStatus && (
                    <div className="space-y-1.5">
                      <Label htmlFor="nhr-year">{tSettings("nhrYear")}</Label>
                      <Input
                        id="nhr-year"
                        type="number"
                        min={2009}
                        max={2024}
                        placeholder={t("yearPlaceholder", { year: 2022 })}
                        className="max-w-xs"
                        value={fiscalProfile.nhrYear ?? ""}
                        onChange={(e) => {
                          const v = e.target.value ? parseInt(e.target.value, 10) : null;
                          updateFiscalProfile("nhrYear", v);
                        }}
                      />
                    </div>
                  )}
                  {fiscalProfile.ificiStatus && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("nhrDisabledByIfici")}
                    </p>
                  )}
                </div>
              )}

              {/* IFICI Status — Portugal only */}
              {isPortugal && (
                <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <Label htmlFor="ifici-status">{tSettings("ificiStatus")}</Label>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        IFICI (Incentivo Fiscal à Investigação Científica e Inovação) replaced NHR
                        for new applicants from 2024. Flat 20% rate.
                      </p>
                    </div>
                    <Switch
                      id="ifici-status"
                      checked={fiscalProfile.ificiStatus}
                      onCheckedChange={(v) => updateFiscalProfile("ificiStatus", v)}
                      disabled={fiscalProfile.nhrStatus}
                    />
                  </div>
                  {fiscalProfile.ificiStatus && (
                    <div className="space-y-1.5">
                      <Label htmlFor="ifici-year">{tSettings("ificiYear")}</Label>
                      <Input
                        id="ifici-year"
                        type="number"
                        min={2024}
                        max={2030}
                        placeholder={t("yearPlaceholder", { year: 2024 })}
                        className="max-w-xs"
                        value={fiscalProfile.ificiYear ?? ""}
                        onChange={(e) => {
                          const v = e.target.value ? parseInt(e.target.value, 10) : null;
                          updateFiscalProfile("ificiYear", v);
                        }}
                      />
                    </div>
                  )}
                  {fiscalProfile.nhrStatus && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("ificiDisabledByNhr")}
                    </p>
                  )}
                </div>
              )}

              <Button
                onClick={saveFiscalProfile}
                disabled={fiscalSaving || !fiscalHasChanges}
                className="w-full sm:w-auto"
              >
                <Save className="h-4 w-4 mr-2" />
                {fiscalSaving ? "Saving..." : "Save Tax Profile"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SettingsTax;
