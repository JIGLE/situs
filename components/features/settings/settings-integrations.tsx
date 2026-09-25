"use client";

import { useTranslations } from "next-intl";
import { Landmark, Layers, ScanLine } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AtConnectionPanel } from "./at-connection-panel";
import { useBankConnections } from "@/lib/hooks/use-bank-connections";
import { BankConnectPanel } from "./bank-connect-panel";

/**
 * The instance's outside connections: the bank, Finanças, and document classification. Each card
 * sets up and checks its connection; the explainability behind them (the bank movement inbox, the
 * tax submission log) lives in Finance, and this tab does not repeat it.
 */
export function SettingsIntegrations() {
  const t = useTranslations("settings.panel");
  const tAt = useTranslations("settings.at");
  const { connections, providersConfigured, loading, reload } = useBankConnections();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            {t("bankConnections")}
          </CardTitle>
          <CardDescription>{t("bankConnectionsHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <BankConnectPanel
            connections={connections}
            providersConfigured={providersConfigured}
            loading={loading}
            onRefresh={reload}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {tAt("title")}
          </CardTitle>
          <CardDescription>{tAt("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AtConnectionPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            {t("documentClassification")}
          </CardTitle>
          <CardDescription>{t("classificationHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {t("mockClassifier")}
              </p>
              <p className="text-xs text-muted-foreground">{t("classifierHelp")}</p>
            </div>
            <span className="inline-block rounded-full bg-[var(--semantic-info-soft)] px-2 py-0.5 text-xs text-[var(--semantic-info-readable)]">
              {t("active")}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SettingsIntegrations;
