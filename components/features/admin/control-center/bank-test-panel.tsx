"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader2, Plug, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/utils/api-client";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { Fact, Panel } from "./panel";

interface Diagnostics {
  key: string;
  displayName: string;
  supportsDiagnostics: boolean;
  checkFailed: string | null;
  configured: boolean;
  authenticated: boolean | null;
  authError: string | null;
  applicationName: string | null;
  environment: string | null;
  redirectUrls: string[];
  expectedRedirectUrl: string | null;
  redirectUrlRegistered: boolean | null;
  institutionsTotal: number | null;
  institutionsByCountry: { country: string; count: number }[];
}

interface TestConnection {
  id: string;
  institutionName: string;
  status: string;
  createdAt: string;
  accounts: number;
  movements: number;
}

interface Institution {
  id: string;
  name: string;
  country: string;
}

/**
 * The operator's bank-connection workbench.
 *
 * Two things that are easy to confuse and must not be: **checking** the connection, which touches
 * nothing, and **testing** it, which runs a real consent against a real provider and leaves a real
 * connection behind. The check is a button you may press whenever the picker looks wrong; the test
 * is a deliberate act with something to clean up afterwards, so it is separated by a rule and
 * states what it will do before it does it.
 *
 * The test connection is not a simulation. It goes through the same consent, the same account
 * persistence and the same import pipeline as a bank you rely on — a test down a different path
 * would prove nothing about the path that matters. The single boundary it does not cross is
 * allocation: sandbox money never creates a receipt against a real lease.
 */
export function BankTestPanel({ className }: { className?: string }) {
  const t = useTranslations("admin.bank");
  const { token: csrfToken } = useCsrf();

  const [diagnostics, setDiagnostics] = useState<Diagnostics[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);

  const [connections, setConnections] = useState<TestConnection[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const body = await apiFetch<{ connections?: TestConnection[] }>(
        "/api/admin/bank-test-connections",
      );
      setConnections(body?.connections ?? []);
    } catch {
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  // The consent callback lands back here with ?bank=connected|failed. Read it once and clear it,
  // the same shape `bank-connect-panel.tsx` uses for the Settings tab, so the message does not
  // reappear on every later visit — and refresh, because the connection it announces is new.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("bank");
    if (!outcome) return;

    setNotice(outcome === "connected" ? t("connected") : t("failed"));
    params.delete("bank");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
    if (outcome === "connected") void loadConnections();
  }, [t, loadConnections]);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(false);
    setNotice(null);
    try {
      const body = await apiFetch<{ providers?: Diagnostics[] }>("/api/admin/bank-provider-check");
      const rows = body?.providers ?? [];
      setDiagnostics(rows);

      // Pre-load the picker only when there is something to pick. Asking for institutions before
      // knowing the application can reach any is how the empty-picker confusion started.
      const usable = rows.find((row) => row.authenticated && (row.institutionsTotal ?? 0) > 0);
      if (usable) {
        const country = usable.institutionsByCountry[0]?.country;
        if (country) {
          const list = await apiFetch<{ institutions?: Institution[] }>(
            `/api/bank/institutions?country=${encodeURIComponent(country)}&provider=${encodeURIComponent(usable.key)}`,
          );
          setInstitutions(list?.institutions ?? []);
          setChosen(list?.institutions?.[0]?.id ?? "");
        }
      }
    } catch {
      setCheckError(true);
    } finally {
      setChecking(false);
    }
  }, []);

  async function startTest() {
    const provider = diagnostics?.find((row) => row.authenticated);
    const institution = institutions.find((row) => row.id === chosen);
    if (!provider || !institution) return;

    setBusy("connect");
    setNotice(null);
    try {
      const body = await apiFetch<{ url?: string }>(
        "/api/bank/connections/connect",
        csrfToken,
        "POST",
        {
          country: institution.country,
          institutionId: institution.id,
          institutionName: institution.name,
          providerKey: provider.key,
          isTest: true,
        },
      );
      // A consent is a redirect to the bank; there is nothing to render here afterwards.
      if (body?.url) window.location.href = body.url;
      else setNotice(t("connectFailed"));
    } catch {
      setNotice(t("connectFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(connection: TestConnection) {
    setBusy(connection.id);
    setNotice(null);
    try {
      const body = await apiFetch<{ removed?: { accounts: number; movements: number } }>(
        `/api/admin/bank-test-connections/${connection.id}`,
        csrfToken,
        "DELETE",
      );
      setNotice(
        t("removed", {
          accounts: body?.removed?.accounts ?? 0,
          movements: body?.removed?.movements ?? 0,
        }),
      );
      await loadConnections();
    } catch {
      setNotice(t("removeFailed"));
    } finally {
      setBusy(null);
    }
  }

  const primary = diagnostics?.[0];

  return (
    <Panel
      title={t("title")}
      className={className}
      action={
        <Button size="sm" variant="secondary" onClick={() => void runCheck()} disabled={checking}>
          {checking ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Plug className="size-3.5" aria-hidden />
          )}
          {t("runCheck")}
        </Button>
      }
      bodyClassName="px-4 py-3 space-y-3"
    >
      {!diagnostics && !checking && (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("idle")}</p>
      )}

      {/*
        The commonest state on a fresh instance, and the one that rendered an empty panel:
        `runBankProviderCheck` iterates the CONFIGURED providers, so with no credentials at all
        the list comes back empty and there is no row to report on. An empty array is an answer —
        "this instance has no bank provider" — and it has to be said, not left as a blank box.
      */}
      {diagnostics?.length === 0 && (
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("notConfigured")}</p>
      )}

      {checkError && (
        <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
          {t("checkFailed")}
        </p>
      )}

      {primary && (
        <div className="space-y-0.5">
          {!primary.configured ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("notConfigured")}</p>
          ) : (
            <>
              <Fact
                label={t("auth")}
                value={
                  primary.authenticated ? (
                    <span className="inline-flex items-center gap-1 text-[var(--semantic-success-readable)]">
                      <Check className="size-3.5" aria-hidden />
                      {t("authOk")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[var(--semantic-danger-readable)]">
                      <X className="size-3.5" aria-hidden />
                      {t(`authError.${primary.authError ?? "unknown"}`, {
                        fallback: primary.authError ?? "",
                      })}
                    </span>
                  )
                }
              />
              {primary.applicationName && (
                <Fact label={t("application")} value={primary.applicationName} />
              )}
              {/* Reported by the provider, never inferred from the URL: with Enable Banking both
                  environments share a host, so the application is the only thing that knows. */}
              {primary.environment && <Fact label={t("environment")} value={primary.environment} />}
              {primary.authenticated && (
                <Fact
                  label={t("redirect")}
                  value={
                    primary.redirectUrlRegistered ? (
                      <span className="text-[var(--semantic-success-readable)]">
                        {t("redirectOk")}
                      </span>
                    ) : (
                      <span className="text-[var(--semantic-warning-readable)]">
                        {t("redirectMissing")}
                      </span>
                    )
                  }
                />
              )}
              {primary.institutionsTotal !== null && (
                <Fact
                  label={t("institutions")}
                  value={
                    primary.institutionsTotal === 0
                      ? t("institutionsNone")
                      : primary.institutionsByCountry
                          .slice(0, 3)
                          .map((row) => `${row.country} ${row.count}`)
                          .join(" · ")
                  }
                />
              )}
            </>
          )}

          {/* The remedy, not just the finding. An unregistered redirect is the failure that does
              not announce itself until you have already been bounced back from a bank. */}
          {primary.authenticated && primary.redirectUrlRegistered === false && (
            <p className="mt-2 flex gap-2 rounded-md bg-[var(--semantic-warning-soft)] px-3 py-2 text-xs text-[var(--color-foreground)]">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-[var(--semantic-warning-readable)]"
                aria-hidden
              />
              <span className="min-w-0 break-all">
                {t("redirectHint")} <code>{primary.expectedRedirectUrl}</code>
              </span>
            </p>
          )}
        </div>
      )}

      {/* Checking is free; testing is not. The rule is the boundary between them. */}
      {primary?.authenticated && institutions.length > 0 && (
        <div className="space-y-2 border-t border-[var(--color-inner-border)] pt-3">
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("testHelp")}</p>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="admin-test-institution">
              {t("chooseInstitution")}
            </label>
            <select
              id="admin-test-institution"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 text-sm text-[var(--color-foreground)]"
            >
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => void startTest()}
              disabled={busy === "connect" || !chosen}
            >
              {busy === "connect" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("startTest")}
            </Button>
          </div>
        </div>
      )}

      {connections.length > 0 && (
        <div className="space-y-2 border-t border-[var(--color-inner-border)] pt-3">
          <p className="text-xs font-medium text-[var(--color-foreground)]">
            {t("existing", { count: connections.length })}
          </p>
          <ul className="space-y-1.5">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex items-center justify-between gap-2 rounded-md bg-[var(--color-canvas)] px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--color-foreground)]">
                    {connection.institutionName}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t("connectionSummary", {
                      status: connection.status,
                      accounts: connection.accounts,
                      movements: connection.movements,
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void remove(connection)}
                  disabled={busy === connection.id}
                  aria-label={t("removeLabel", { name: connection.institutionName })}
                >
                  {busy === connection.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && (
        <p role="status" className="text-xs text-[var(--color-muted-foreground)]">
          {notice}
        </p>
      )}
    </Panel>
  );
}
