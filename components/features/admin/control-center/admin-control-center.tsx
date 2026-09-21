"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/utils/api-client";
import type { SystemStatus } from "@/lib/services/admin/system-status";
import { SEVERITY_STYLE, SUMMARY_ORDER } from "../system-status-view";
import { BankTestPanel } from "./bank-test-panel";
import { Fact, Panel } from "./panel";

interface SignInStatus {
  providers: { key: string; configured: boolean }[];
  registration: "open_bootstrap" | "closed";
  totalAccounts: number;
  adminAccounts: number;
  allowlist: string[];
}

/**
 * The instance at a glance.
 *
 * `/admin` used to be the status list and nothing else, so answering "is this instance healthy?"
 * meant visiting four tabs and holding the answers in your head. The tabs still exist and are
 * still where the full detail lives — this is the layer above them: every domain reduced to what
 * an operator would actually act on, in one view that does not scroll.
 *
 * NOT SCROLLING IS THE CONSTRAINT, and it is enforced structurally rather than by hoping the
 * content stays short. Above `lg` the grid is exactly the height of its container and each panel
 * scrolls inside its own box. Below `lg` the whole thing becomes a normal stacked column and the
 * page scrolls, because a phone has no viewport to fit a control centre into and the alternative
 * is six nested scroll areas fighting each other.
 *
 * Every panel loads independently. One endpoint being down leaves a single tile reporting a
 * problem instead of blanking the screen — this page is opened precisely when something is
 * broken, so a failure here has to stay local.
 */
export function AdminControlCenter() {
  const t = useTranslations("admin");
  const tc = useTranslations("admin.controlCenter");

  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [signIn, setSignIn] = useState<SignInStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    // Settled, not all: a control centre whose panels are all blank because one endpoint failed
    // is exactly the outage it exists to report on.
    const [statusRes, signInRes] = await Promise.allSettled([
      fetch("/api/admin/system-status", { cache: "no-store" }).then((r) => r.json()),
      apiFetch<SignInStatus>("/api/admin/sign-in-status"),
    ]);

    setStatus(statusRes.status === "fulfilled" ? (statusRes.value?.data ?? null) : null);
    setSignIn(signInRes.status === "fulfilled" ? signInRes.value : null);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-none flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-[var(--color-foreground)]">
            {tc("title")}
          </h1>
          {status && (
            <div className="flex flex-wrap gap-1.5" aria-label={t("summary")}>
              {SUMMARY_ORDER.filter((severity) => status.counts[severity] > 0).map((severity) => (
                <span
                  key={severity}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[severity].chip}`}
                >
                  {status.counts[severity]} {t(`severity.${severity}`)}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
          {t("refresh")}
        </Button>
      </header>

      {/*
        `auto` then `1fr`, not two equal rows. Access and Metrics state a handful of facts and
        stretching them to half the viewport leaves a panel that is mostly empty — which reads as
        broken rather than calm. Letting the top row hug its content hands the slack to the row
        below, where the two panels that actually grow live: test connections accumulate, and the
        accounts list is unbounded.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)]">
        {/* Status takes the tall left column: it is the only panel whose row count is unbounded,
            so it is the one that most needs room to scroll in place. */}
        <Panel
          title={t("title")}
          className="lg:col-span-5 lg:row-span-2"
          action={<DetailLink href="/admin/status" label={tc("openDetail")} />}
        >
          {status ? (
            <ul className="divide-y divide-[var(--color-inner-border)]">
              {status.checks.map((check) => {
                const style = SEVERITY_STYLE[check.severity];
                const Icon = style.icon;
                return (
                  <li key={check.id} className="flex items-center gap-2.5 px-4 py-2">
                    <Icon className={`size-3.5 shrink-0 ${style.accent}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-foreground)]">
                      {t(`check.${check.id.split(":")[0]}`, {
                        country: check.id.split(":")[1] ?? "",
                      })}
                    </span>
                    {check.severity === "ok" ? (
                      <span className="sr-only">{t(`severity.${check.severity}`)}</span>
                    ) : (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.chip}`}
                      >
                        {t(`severity.${check.severity}`)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Unavailable label={tc("unavailable")} />
          )}
        </Panel>

        <Panel
          title={t("signIn.title")}
          className="lg:col-span-4"
          action={<DetailLink href="/admin/sign-in" label={tc("openDetail")} />}
          bodyClassName="px-4 py-2.5"
        >
          {signIn ? (
            <>
              <Fact
                label={tc("registration")}
                value={
                  <span
                    className={
                      signIn.registration === "closed"
                        ? "text-[var(--semantic-success-readable)]"
                        : "text-[var(--semantic-warning-readable)]"
                    }
                  >
                    {signIn.registration === "closed"
                      ? t("signIn.registrationClosed")
                      : t("signIn.registrationOpen")}
                  </span>
                }
              />
              <Fact
                label={t("signIn.providers")}
                value={signIn.providers
                  .filter((provider) => provider.configured)
                  .map((provider) => t(`signIn.provider.${provider.key}`))
                  .join(" · ")}
              />
              <Fact
                label={t("signIn.allowlist")}
                value={
                  signIn.allowlist.length === 0
                    ? t("signIn.allowlistEmpty")
                    : signIn.allowlist.join(", ")
                }
                tone={signIn.allowlist.length === 0 ? "muted" : "normal"}
              />
            </>
          ) : (
            <Unavailable label={tc("unavailable")} />
          )}
        </Panel>

        <BankTestPanel className="lg:col-span-4" />
      </div>
    </div>
  );
}

function DetailLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
    >
      {label}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

/** Says which panel could not load, rather than leaving an empty box that reads as "nothing here". */
function Unavailable({ label }: { label: string }) {
  return <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{label}</p>;
}
