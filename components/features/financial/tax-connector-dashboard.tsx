"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils/format-date";
import { MODE_KIND_STYLES, authorityName, modeKind } from "@/lib/tax/connectors/presentation";
import { useCallback, useEffect, useState } from "react";

/**
 * Situs Tax Connector Dashboard — every fiscal connector (PT AT, ES AEAT, …)
 * with its mode/status/last submission and the explainability trail behind
 * every call (Migration C: TaxAuthorityConnector + TaxSubmissionLog). Mode
 * stays sandbox/review until a connector is explicitly promoted to live —
 * this view is where that would become visible, not where it's changed.
 */

interface Connector {
  id: string;
  country: string;
  connectorKey: string;
  mode: string;
  status: string;
  lastSubmissionAt: string | null;
}

interface SubmissionLog {
  id: string;
  connectorId: string;
  subjectType: string;
  subjectId: string;
  action: string;
  mode: string;
  status: string;
  responseCode: string | null;
  createdAt: string;
}

// Mode styling now comes from lib/tax/connectors/presentation.ts. The old table styled
// `live` with the SUCCESS token — green, the colour of "working" — when live is precisely the
// mode the connector refuses to act in. Colour was saying the opposite of the truth.

const LOG_STATUS_STYLES: Record<string, string> = {
  success: "text-[var(--semantic-success-readable)]",
  error: "text-[var(--semantic-danger-readable)]",
  pending: "text-[var(--semantic-warning-readable)]",
};

export function TaxConnectorDashboard(): React.ReactElement | null {
  const t = useTranslations("common");
  const locale = useLocale();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [logsByConnector, setLogsByConnector] = useState<Record<string, SubmissionLog[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tax/connectors", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      setConnectors(body?.data?.connectors ?? []);
      setLogsByConnector(body?.data?.logs ?? {});
    } catch (err) {
      // One translated sentence, not `err.message`. What reached the panel before was whichever
      // English string the failure happened to carry — a status code from the line above, or
      // whatever the fetch itself threw. None of it is actionable, and none of it was ever going
      // to be in the reader's language.
      console.error("Failed to load tax connectors:", err);
      setError(t("taxConnectorsLoadFailed"));
      setConnectors([]);
    } finally {
      setLoading(false);
    }
    // `t` is stable for a given locale; listed so the dependency is honest rather than silenced.
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loading && connectors.length === 0 && !error) {
    return (
      <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted-foreground)]">
        {t("taxConnectorsEmpty")}
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <p className="mono-label">{t("taxConnectorsHeading")}</p>
      </div>

      {error ? (
        <p className="border-b border-[var(--color-border)] px-4 py-2 text-sm text-[var(--semantic-danger-readable)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">{t("loading")}</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {connectors.map((connector) => {
            const logs = logsByConnector[connector.id] ?? [];
            const isExpanded = expanded === connector.id;
            return (
              <div key={connector.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : connector.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-hover)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs uppercase tracking-[0.04em]">
                      {connector.country}
                    </span>
                    <span className="text-sm">{authorityName(connector.country)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] uppercase tracking-[0.04em] ${
                        MODE_KIND_STYLES[modeKind(connector.mode)]
                      }`}
                      title={
                        modeKind(connector.mode) === "simulated"
                          ? t("connectorModeSimulatedHelp", {
                              authority: authorityName(connector.country),
                            })
                          : t("connectorModeUnsupportedHelp", { mode: connector.mode })
                      }
                    >
                      {modeKind(connector.mode) === "simulated"
                        ? t("connectorModeSimulated")
                        : t("connectorModeUnsupported")}
                    </span>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {connector.lastSubmissionAt
                        ? t("connectorLastSubmission", {
                            date: formatDate(connector.lastSubmissionAt, locale),
                          })
                        : t("connectorNoSubmissions")}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-[var(--color-border)] bg-[var(--color-hover)] px-4 py-2">
                    {logs.length === 0 ? (
                      <p className="py-2 text-xs text-[var(--color-muted-foreground)]">
                        {t("noSubmissionLog")}
                      </p>
                    ) : (
                      <div className="space-y-1 py-2">
                        {logs.map((log) => (
                          <div
                            key={log.id}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="font-mono">
                              {log.action} · {log.subjectType}
                            </span>
                            <span className={`font-mono ${LOG_STATUS_STYLES[log.status] ?? ""}`}>
                              {log.status}
                              {log.responseCode ? ` (${log.responseCode})` : ""}
                            </span>
                            <span className="tabular-nums text-[var(--color-muted-foreground)]">
                              {new Date(log.createdAt).toLocaleString(locale)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
