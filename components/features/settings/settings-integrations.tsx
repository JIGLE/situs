"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Landmark, Layers, ScanLine } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate as formatDateWithLocale } from "@/lib/utils/format-date";
import { authorityName } from "@/lib/tax/connectors/presentation";
import { useConnectorMode } from "@/components/shared/connector-mode";
import { BankConnectPanel, type BankConnectionRow } from "./bank-connect-panel";

interface TaxConnector {
  id: string;
  country: string;
  connectorKey: string;
  mode: string;
  status: string;
  lastSubmissionAt: string | null;
}

// A mode is put into words by useConnectorMode, shared with the Finance tax dashboard so the two
// cannot drift apart. The old table styled `live` as SUCCESS — green — when it is the one mode
// the connector refuses to act in.

/**
 * Read-only status summary for the three Situs automation layers — a
 * quick "is this connected" glance, not a drill-down. Full explainability
 * (submission logs, bank movement inbox) lives in Finance; this tab links
 * out rather than duplicating that view.
 */
export function SettingsIntegrations() {
  const t = useTranslations("settings.panel");
  const connectorMode = useConnectorMode();
  const locale = useLocale();
  const [connections, setConnections] = useState<BankConnectionRow[]>([]);
  const [providersConfigured, setProvidersConfigured] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<TaxConnector[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a connect or a sync so the list reflects what just happened.
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bankRes, taxRes] = await Promise.all([
          fetch("/api/bank/connections", { credentials: "include" }),
          fetch("/api/tax/connectors", { credentials: "include" }),
        ]);
        if (!cancelled && bankRes.ok) {
          const body = await bankRes.json();
          setConnections(body?.data?.connections ?? []);
          setProvidersConfigured(body?.data?.providersConfigured ?? []);
        }
        if (!cancelled && taxRes.ok) {
          const body = await taxRes.json();
          setConnectors(body?.data?.connectors ?? []);
        }
      } catch {
        // Best-effort status view — leave empty on failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

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
            onRefresh={refresh}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t("taxConnectors")}
          </CardTitle>
          <CardDescription>{t("taxConnectorsHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noConnectors")}</p>
          ) : (
            <div className="space-y-2">
              {connectors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--color-foreground)]">
                      {c.country} — {authorityName(c.country)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {connectorMode.help(c.mode, c.country)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("lastSubmission", {
                        date: formatDateWithLocale(c.lastSubmissionAt, locale),
                      })}
                    </p>
                  </div>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs ${connectorMode.badgeClass(c.mode)}`}
                  >
                    {connectorMode.label(c.mode)}
                  </span>
                </div>
              ))}
            </div>
          )}
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
