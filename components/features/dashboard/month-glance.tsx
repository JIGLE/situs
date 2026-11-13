"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, CircleDot } from "lucide-react";

import type { DashboardMonth } from "@/lib/services/dashboard/month";
import { useCurrency } from "@/lib/contexts/currency-context";
import { CONSENT_WARNING_DAYS, daysUntil } from "@/lib/utils/bank-inbox";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import { rentPeriodStatusKey } from "@/lib/utils/rent-period-labels";
import { CELL_ICONS, CELL_STYLES } from "@/components/features/financial/rent-status-styles";
import { Button } from "@/components/ui/button";
import { BlockHeading } from "@/components/shared/panel";
import { cn } from "@/lib/utils/utils";

/** Where each step's work is done. */
const LINKS = {
  rentMatrix: "/financials?tab=ledger",
  integrations: "/settings?tab=integrations",
  complete: "/complete",
} as const;

/**
 * One of Home's blocks: its heading above, its rows in a box below (design study D2). The heading
 * sat inside the box as a small grey label over a rule, where it read as a caption.
 */
function Block({
  title,
  action,
  testId,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <BlockHeading title={title} action={action} />
      <div className="panel">{children}</div>
    </section>
  );
}

function SeeAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-6 items-center justify-end text-sm text-[var(--color-primary)] hover:underline max-md:min-h-11 max-md:min-w-11"
    >
      {children}
    </Link>
  );
}

/**
 * The bank, in one line: its consent has ended, or ends soon, in the warning colours; otherwise
 * a quiet "Millennium BCP · sincronizado há 2 horas", so the owner knows the inbox is current.
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
  // Working: a quiet line that says the inbox is current.
  return (
    <Link
      href={LINKS.integrations}
      className="block text-sm text-[var(--color-muted-foreground)] hover:underline max-md:min-h-11"
      data-testid="dashboard-status"
    >
      {bank.lastSyncAt
        ? t("bankSynced", { bank: bank.name, when: timeAgo(bank.lastSyncAt, locale) })
        : t("bankNotSynced", { bank: bank.name })}
    </Link>
  );
}

/**
 * "Requer a sua atenção": what waits besides the inbox and who is late, shown only when something
 * does. Contracts reaching their term are under "A seguir" now, with their dates. The months owed, the movements and the receipts used to be counted here too, each a link
 * to another tab; the Home inbox and the late list now show them in place.
 */
export function AttentionList({ attention }: { attention: DashboardMonth["attention"] }) {
  const t = useTranslations("dashboard");

  const items = [
    attention.missingData > 0 && {
      key: "missing",
      text: t("attentionMissing", { count: attention.missingData }),
      href: LINKS.complete,
      tone: "warning" as const,
    },
  ].filter((item) => item !== false);

  if (items.length === 0) return null;

  return (
    <Block title={t("attentionTitle")} testId="dashboard-attention">
      <ul className="divide-y divide-[var(--color-hairline)]">
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
    </Block>
  );
}

/**
 * Who is late, and by how much: one line per tenancy with a month still owed, most owed first,
 * saying since when, each opening its oldest month owed. Shown only when someone owes.
 */
export function LateList({ late }: { late: DashboardMonth["late"] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  if (late.length === 0) return null;

  return (
    <Block
      title={t("lateTitle")}
      action={<SeeAll href={LINKS.rentMatrix}>{t("lateSeeAll")}</SeeAll>}
      testId="dashboard-late"
    >
      <ul className="divide-y divide-[var(--color-hairline)]">
        {late.map((entry) => (
          <li key={entry.leaseId}>
            <Link
              href={monthSheetHref(entry.leaseId, entry.since)}
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-muted)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{entry.tenantName}</span>
                {/* Wraps rather than cutting off "since when" on a phone. */}
                <span className="block text-xs text-[var(--color-muted-foreground)]">
                  {entry.propertyName} · {t("lateMonths", { count: entry.months })}{" "}
                  {t("lateSince", { month: sinceLabel(entry.since, locale) })}
                </span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {formatCurrency(entry.amount)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** A tenancy's month in the rent map's month sheet: `?month=<leaseId>:<yyyy-mm>`. */
function monthSheetHref(leaseId: string, yearMonth: string): string {
  return `/financials?tab=ledger&month=${leaseId}:${yearMonth}`;
}

/** `2026-06` as "junho de 2026" in the app's locale. */
function sinceLabel(yearMonth: string, locale: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return formatMonthYear(year, month, locale);
}

/** A day and short month, "8/06" style in the app's locale, for dates inside a known month. */
function dayMonth(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** "há 2 horas", "ontem": how long ago, in the app's locale. */
function timeAgo(iso: string, locale: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

/**
 * The shown month, by tenancy: how much of the month's rent has arrived, as one line and a bar,
 * then a row per tenancy with its status, what it owes and when it was paid or falls due. It is
 * the month's column of the rent map, readable at a glance, and it holds the month arrows, since
 * they change only this block. It replaced three boxes (Esperado, Recebido, Em falta) that said
 * how much but not who, and whose figures overran their boxes at 360px.
 */
export function MonthBlock({
  year,
  month,
  figures,
  tenancies,
  onPrevious,
  onNext,
}: {
  year: number;
  month: number;
  figures: DashboardMonth["figures"];
  tenancies: DashboardMonth["tenancies"];
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("dashboard");
  const tStatus = useTranslations("rentPeriodStatus");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
  const share = figures.expected > 0 ? Math.min(1, figures.received / figures.expected) : 0;

  return (
    <section className="space-y-2" data-testid="dashboard-month-block">
      {/* The month is the block's heading, with its arrows, since they change only this block. */}
      <div className="flex min-h-8 items-center">
        <Button variant="ghost" size="icon" aria-label={t("previousMonth")} onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h2
          className="min-w-32 text-center text-reading font-semibold first-letter:uppercase"
          aria-live="polite"
          data-testid="dashboard-month"
        >
          {formatMonthYear(year, month, locale)}
        </h2>
        <Button variant="ghost" size="icon" aria-label={t("nextMonth")} onClick={onNext}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="panel">
        {figures.expected > 0 && (
          <div className="space-y-2 px-4 pt-4">
            {/* The one figure the month is about, large (design study D3). */}
            <p className="tabular-nums" data-testid="dashboard-figures">
              <span className="text-2xl font-semibold tracking-tight">
                {formatCurrency(figures.received)}
              </span>{" "}
              <span className="text-base font-medium text-[var(--color-muted-foreground)]">
                {t("monthOf", { expected: formatCurrency(figures.expected) })}
              </span>
            </p>
            <div
              className="h-1.5 w-full bg-[var(--color-muted)]"
              role="img"
              aria-label={t("monthReceivedOf", {
                received: formatCurrency(figures.received),
                expected: formatCurrency(figures.expected),
              })}
            >
              <div
                className="h-full bg-[var(--semantic-success)]"
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
            <p
              className={cn(
                "text-xs tabular-nums",
                figures.outstanding > 0
                  ? "text-[var(--semantic-danger-readable)]"
                  : "text-[var(--semantic-success-readable)]",
              )}
            >
              {figures.outstanding > 0
                ? t("monthOutstanding", { amount: formatCurrency(figures.outstanding) })
                : t("monthAllIn")}
            </p>
          </div>
        )}

        {tenancies.length === 0 ? (
          <p className="px-4 py-4 text-sm text-[var(--color-muted-foreground)]">
            {t("monthEmpty")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]">
            {tenancies.map((row) => {
              const Icon = CELL_ICONS[row.status] ?? CircleDot;
              const statusKey = rentPeriodStatusKey(row.status);
              const paid = row.status === "paid" || row.status === "paid_late";
              const detail = paid
                ? t("tenancyPaidOn", { date: dayMonth(row.paidAt ?? row.dueDate, locale) })
                : row.status === "partially_paid"
                  ? t("tenancyPartial", {
                      received: formatCurrency(row.allocatedAmount),
                      due: formatCurrency(row.dueAmount),
                    })
                  : row.status === "overdue"
                    ? t("tenancyOverdue", { date: dayMonth(row.dueDate, locale) })
                    : t("tenancyDueOn", { date: dayMonth(row.dueDate, locale) });
              return (
                <li key={row.leaseId}>
                  <Link
                    href={monthSheetHref(row.leaseId, yearMonth)}
                    className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-muted)]"
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center",
                        CELL_STYLES[row.status],
                      )}
                      title={statusKey ? tStatus(statusKey) : undefined}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {statusKey && <span className="sr-only">{tStatus(statusKey)}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.tenantName}</span>
                      <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                        {row.propertyName}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm tabular-nums">
                        {formatCurrency(row.dueAmount)}
                      </span>
                      <span
                        className={cn(
                          "block text-xs",
                          row.status === "overdue"
                            ? "text-[var(--semantic-danger-readable)]"
                            : "text-[var(--color-muted-foreground)]",
                        )}
                      >
                        {detail}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The year of the shown month so far, as one line of text: received, expenses and the net. */
export function YearLine({ year, totals }: { year: number; totals: DashboardMonth["yearTotals"] }) {
  const t = useTranslations("dashboard");
  const { formatCurrency } = useCurrency();
  if (totals.received === 0 && totals.expenses === 0) return null;
  return (
    <p
      className="text-sm text-[var(--color-muted-foreground)] tabular-nums"
      data-testid="dashboard-year"
    >
      {t("yearLine", {
        year,
        received: formatCurrency(totals.received),
        expenses: formatCurrency(totals.expenses),
        net: formatCurrency(totals.received - totals.expenses),
      })}
    </p>
  );
}

/**
 * What comes next, soonest first: rent falling due, rent increases starting, contracts reaching
 * their term (renewing, for one that renews by itself). Each opens its lease.
 */
export function UpcomingList({ upcoming }: { upcoming: DashboardMonth["upcoming"] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  if (upcoming.length === 0) return null;

  return (
    <Block title={t("upcomingTitle")} testId="dashboard-upcoming">
      <ul className="divide-y divide-[var(--color-hairline)]">
        {upcoming.slice(0, 8).map((item) => {
          const text =
            item.kind === "rent"
              ? t("upcomingRent", { name: item.tenantName })
              : item.kind === "increase"
                ? t("upcomingIncrease", { name: item.tenantName })
                : item.autoRenew
                  ? t("upcomingRenews", { name: item.tenantName })
                  : t("upcomingEnds", { name: item.tenantName });
          const value =
            item.kind === "rent"
              ? formatCurrency(item.amount)
              : item.kind === "increase"
                ? `${formatCurrency(item.previousRent)} → ${formatCurrency(item.newRent)}`
                : null;
          return (
            <li key={`${item.kind}-${item.leaseId}-${item.date}`}>
              <Link
                href={`/portfolio?tab=leases&detail=lease:${item.leaseId}`}
                className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-muted)]"
              >
                <span className="w-14 shrink-0 text-xs tabular-nums text-[var(--color-muted-foreground)]">
                  {dayMonth(item.date, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{text}</span>
                {value && <span className="shrink-0 text-sm tabular-nums">{value}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}
