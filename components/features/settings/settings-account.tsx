"use client";

import { Info, KeyRound, MonitorSmartphone, Shield } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AuditTrail } from "@/components/shared/audit-trail";

interface SettingsAccountProps {
  appVersion: string;
}

/**
 * Identity and account-level records.
 *
 * Sessions, API tokens and the audit trail came from the standalone `/account` page, which was
 * otherwise a read-only shadow of this screen — its Security card showed the 2FA state and then
 * linked here for the control. Appearance and the GDPR export/delete controls moved out to their
 * own sections, so this one has a single subject.
 */
export function SettingsAccount({ appVersion }: SettingsAccountProps) {
  const { data: session } = useSession();
  const t = useTranslations("settings.panel");
  const tStatus = useTranslations("status");

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
