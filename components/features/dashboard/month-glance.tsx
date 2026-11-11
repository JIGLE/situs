"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";

import type { DashboardMonth } from "@/lib/services/dashboard/month";
import { useCurrency } from "@/lib/contexts/currency-context";
import { CONSENT_WARNING_DAYS, daysUntil } from "@/lib/utils/bank-inbox";
import { formatDate } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/utils";

/** Where each step's work is done. */
const LINKS = {
  rentMatrix: "/financials?tab=ledger",
  leases: "/leases",
  integrations: "/settings?tab=integrations",
  complete: "/complete",
} as const;

/** A section's label: one heading per screen, so these are labels, not headings. */
function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
      <p className="mono-label">{children}</p>
      {action}
    </div>
  );
}

function SeeAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-end text-sm text-[var(--color-primary)] hover:underline max-md:min-h-11 max-md:min-w-11"
    >
      {children}
    </Link>
  );
}

/**
 * The bank, in one line, only when something is wrong with it: its consent has ended, or ends
 * soon. A bank that works and Finanças' mode are not news, so they are no longer said on every
 * visit; Settings › Integrations shows both.
 */
export function StatusLine({ status }: { status: DashboardMonth["status"] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { bank } = status;
  if (!bank) return null;

  if (bank.expired) {
    return (
      <Link
        href={LINKS.integrations}
        className="block text-sm text-[var(--semantic-danger-readable)] hover:underline max-md:min-h-11"
        data-testid="dashboard-status"
      >
        {t("statusConsentEnded")}
      </Link>
    );
  }
  if (bank.consentEndsAt && daysUntil(bank.consentEndsAt) <= CONSENT_WARNING_DAYS) {
    return (
      <Link
        href={LINKS.integrations}
        className="block text-sm text-[var(--semantic-warning-readable)] hover:underline max-md:min-h-11"
        data-testid="dashboard-status"
      >
        {t("statusConsentEndsOn", { date: formatDate(bank.consentEndsAt, locale) })}
      </Link>
    );
  }
  return null;
}

/** Esperado, Recebido, Em falta: one stat row. */
export function MonthFigures({ figures }: { figures: DashboardMonth["figures"] }) {
  const t = useTranslations("dashboard");
  const { formatCurrency } = useCurrency();
  const owed = figures.outstanding > 0;

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="panel p-4">
        <p className="mono-label">{t("figureExpected")}</p>
        <p className="mt-2 text-lg font-light tabular-nums sm:text-2xl">
          {formatCurrency(figures.expected)}
        </p>
      </div>
      <div className="panel border-l-[3px] border-l-[var(--country-highlight-readable)] p-4">
        <p className="mono-label">{t("figureReceived")}</p>
        <p className="mt-2 text-lg font-light tabular-nums sm:text-2xl">
          {formatCurrency(figures.received)}
        </p>
      </div>
      <div
        className={cn(
          "panel p-4",
          owed &&
            "border-l-[3px] border-l-[var(--semantic-danger)] bg-[var(--semantic-danger-soft)]",
        )}
      >
        <p className="mono-label">{t("figureOutstanding")}</p>
        <p
          className={cn(
            "mt-2 text-lg font-light tabular-nums sm:text-2xl",
            owed && "text-[var(--semantic-danger-readable)]",
          )}
        >
          {formatCurrency(figures.outstanding)}
        </p>
      </div>
    </div>
  );
}

/**
 * "Requer a sua atenção": what waits besides the inbox and who is late, shown only when something
 * does. The months owed, the movements and the receipts used to be counted here too, each a link
 * to another tab; the Home inbox and the late list now show them in place.
 */
export function AttentionList({ attention }: { attention: DashboardMonth["attention"] }) {
  const t = useTranslations("dashboard");

  const items = [
    attention.leasesEnding > 0 && {
      key: "leases",
      text: t("attentionLeases", { count: attention.leasesEnding }),
      href: LINKS.leases,
      tone: "info" as const,
    },
    attention.missingData > 0 && {
      key: "missing",
      text: t("attentionMissing", { count: attention.missingData }),
      href: LINKS.complete,
      tone: "warning" as const,
    },
  ].filter((item) => item !== false);

  if (items.length === 0) return null;

  return (
    <div className="panel" data-testid="dashboard-attention">
      <SectionLabel>{t("attentionTitle")}</SectionLabel>
      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-[var(--color-muted)]"
            >
              <span
                className={cn(item.tone === "warning" && "text-[var(--semantic-warning-readable)]")}
              >
                {item.text}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Who is late, and by how much: one line per tenancy with a month still owed, most owed first,
 * each opening the lease. Shown only when someone owes.
 */
export function LateList({ late }: { late: DashboardMonth["late"] }) {
  const t = useTranslations("dashboard");
  const { formatCurrency } = useCurrency();
  if (late.length === 0) return null;

  return (
    <div className="panel" data-testid="dashboard-late">
      <SectionLabel action={<SeeAll href={LINKS.rentMatrix}>{t("lateSeeAll")}</SeeAll>}>
        {t("lateTitle")}
      </SectionLabel>
      <ul className="divide-y divide-[var(--color-border)]">
        {late.map((entry) => (
          <li key={entry.leaseId}>
            <Link
              href={`/leases?detail=lease:${entry.leaseId}`}
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-muted)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{entry.tenantName}</span>
                <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                  {entry.propertyName} · {t("lateMonths", { count: entry.months })}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums text-[var(--semantic-danger-readable)]">
                {formatCurrency(entry.amount)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
