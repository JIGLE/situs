"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Info, RefreshCw } from "lucide-react";
import { formatDateTime } from "@/lib/utils/format-date";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { StatusSeverity, SystemStatus } from "@/lib/services/admin/system-status";

/**
 * Operator view of what this instance is actually connected to.
 *
 * The design constraint that shapes everything here: **`simulated` must not look like `ok`.**
 * The connector screens originally rendered `live` in green — the colour of "working" — on the
 * one mode that refuses to act, and the whole point of this page is to stop an operator
 * believing a connection exists when it does not. So `ok` is the only state that gets the
 * success colour, and simulated states get an unmistakably different, informational treatment
 * with the word "simulated" in the text rather than only in the styling.
 *
 * The page renders outside AppDataGate (see app-data-gate.tsx): it has to work when the app
 * does not, because that is when someone opens it.
 *
 * ── Why this is a divided list and not ten cards ──────────────────────────────────────────
 * It was one `Card` per check, which put ten borders, ten shadows and ten hover-lifts on a
 * screen whose entire job is to be scanned. Nothing here is clickable, so the lift was
 * promising an interaction that does not exist, and the repeated chrome made the one row that
 * needed attention look exactly like the six that did not.
 *
 * So: one panel per group, hairline-divided rows, and a severity rule down the left edge that
 * can be scanned as a column without reading a word. The chip is spent only where it earns its
 * place — a row that is fine says so with its icon and gets out of the way, which is what lets
 * `warning` and `simulated` actually stand out.
 */

export interface SeverityStyle {
  /** Badge fill + text, used only where a row is not `ok`. */
  chip: string;
  /** Icon and left-rule colour. Kept separate from `chip`: this used to be recovered by
   *  `chip.split(" ").pop()`, which worked only while the text class happened to be last. */
  accent: string;
  /** Left rule. The `-readable` variant, not the raw hue: raw `--semantic-success` is #166534,
   *  which on the dark theme's #121B15 panel is a rule you have to hunt for. */
  rule: string;
  icon: typeof Info;
}

export const SEVERITY_STYLE: Record<StatusSeverity, SeverityStyle> = {
  ok: {
    chip: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
    accent: "text-[var(--semantic-success-readable)]",
    rule: "bg-[var(--semantic-success-readable)]",
    icon: CheckCircle2,
  },
  simulated: {
    chip: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
    accent: "text-[var(--semantic-info-readable)]",
    rule: "bg-[var(--semantic-info-readable)]",
    icon: FlaskConical,
  },
  warning: {
    chip: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
    accent: "text-[var(--semantic-warning-readable)]",
    rule: "bg-[var(--semantic-warning-readable)]",
    icon: Info,
  },
  error: {
    chip: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
    accent: "text-[var(--semantic-danger-readable)]",
    rule: "bg-[var(--semantic-danger-readable)]",
    icon: AlertTriangle,
  },
};

/** Order the summary reads in: what needs a human first, what is merely true last. */
export const SUMMARY_ORDER: StatusSeverity[] = ["error", "warning", "simulated", "ok"];

export function SystemStatusView() {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/system-status", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      setStatus(body.data as SystemStatus);
    } catch {
      // No error text from the response: this endpoint is admin-only but the page is still a
      // browser surface, and the server log already holds the detail.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
              {t("title")}
            </h1>
            <p className="max-w-2xl text-sm text-[var(--color-muted-foreground)]">
              {t("subtitle")}
            </p>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            {t("refresh")}
          </Button>
        </div>

        {/* The counts belong with the title, not in a band of their own below it — they are the
            subtitle of this page in the most literal sense. */}
        {status && (
          <div className="flex flex-wrap gap-2" aria-label={t("summary")}>
            {SUMMARY_ORDER.filter((severity) => status.counts[severity] > 0).map((severity) => (
              <span
                key={severity}
                className={`rounded-full px-3 py-1 text-xs font-medium ${SEVERITY_STYLE[severity].chip}`}
              >
                {status.counts[severity]} {t(`severity.${severity}`)}
              </span>
            ))}
          </div>
        )}

        {/* The standing disclosure. Not conditional on any check, because it is true of every
            deployment today and an operator should not have to infer it from a row's styling.
            It was a bordered card, which gave a sentence of context the same visual weight as
            the findings themselves; a quiet rule-and-icon line says it without competing. */}
        <p className="flex gap-2.5 border-l-2 border-[var(--semantic-info)] py-1 pl-3 text-sm text-[var(--color-muted-foreground)]">
          <FlaskConical
            className="mt-0.5 size-4 shrink-0 text-[var(--semantic-info-readable)]"
            aria-hidden
          />
          <span className="max-w-3xl">{t("simulationNotice")}</span>
        </p>
      </header>

      {failed && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--semantic-danger)] bg-[var(--semantic-danger-soft)] p-4"
        >
          <p className="text-sm text-[var(--color-foreground)]">{t("loadFailed")}</p>
        </div>
      )}

      {loading && !status && (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("checking")}</p>
      )}

      {status && (
        <>
          {(["platform", "integration"] as const).map((group) => {
            const rows = status.checks.filter((check) => check.group === group);
            if (rows.length === 0) return null;

            return (
              <section key={group} className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted-foreground)]">
                  {t(`group.${group}`)}
                </h2>

                <div className="divide-y divide-[var(--color-inner-border)] overflow-hidden rounded-xl border border-[var(--color-inner-border)] bg-[var(--color-surface-solid)]">
                  {rows.map((check) => {
                    const style = SEVERITY_STYLE[check.severity];
                    const Icon = style.icon;
                    const severityLabel = t(`severity.${check.severity}`);
                    return (
                      <div key={check.id} className="relative flex gap-3 py-3.5 pl-4 pr-4">
                        {/* Scannable as a column: the eye finds the odd colour out without
                            reading any of the labels. */}
                        <span
                          className={`absolute inset-y-0 left-0 w-0.5 ${style.rule}`}
                          aria-hidden
                        />
                        <Icon className={`mt-0.5 size-4 shrink-0 ${style.accent}`} aria-hidden />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                              {t(`check.${check.id.split(":")[0]}`, {
                                country: check.id.split(":")[1] ?? "",
                              })}
                            </h3>
                            {/* An `ok` row is the default and does not need to say so twice —
                                its icon and rule already do. Dropping the chip here is what
                                gives the exceptional rows somewhere to stand out from. The
                                state still reaches assistive tech via the label below. */}
                            {check.severity === "ok" ? (
                              <span className="sr-only">{severityLabel}</span>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.chip}`}
                              >
                                {severityLabel}
                              </span>
                            )}
                          </div>
                          {check.detail && (
                            <p className="text-sm text-[var(--color-muted-foreground)]">
                              {check.detail}
                            </p>
                          )}
                          {/* The remedy is the reason this page exists rather than a status
                              dashboard: knowing something is wrong is only useful with the
                              next step attached. */}
                          {check.remedy && (
                            <p className="text-sm text-[var(--color-foreground)]">
                              <span className="text-[var(--color-muted-foreground)]">
                                {t("remedy")}:{" "}
                              </span>
                              {check.remedy}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("generatedAt", { time: formatDateTime(status.generatedAt, locale) })}
          </p>
        </>
      )}
    </div>
  );
}
