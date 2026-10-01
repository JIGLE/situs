"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";

import type { DashboardMonth } from "@/lib/services/dashboard/month";
import { useCurrency } from "@/lib/contexts/currency-context";
import { SIMULATED_MODES, TEST_MODES } from "@/lib/tax/connectors/modes";
import { auditActionKey } from "@/lib/utils/audit-labels";
import { CONSENT_WARNING_DAYS, daysUntil } from "@/lib/utils/bank-inbox";
import { formatDate, formatDateTime } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/utils";

/** Where each step's work is done. */
const LINKS = {
  rentMatrix: "/financials?tab=rent-matrix",
  bank: "/financials?tab=bank",
  receipts: "/financials?tab=receipts",
  tax: "/financials?tab=tax",
  leases: "/leases",
  activity: "/settings?tab=account",
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
 * The bank and Finanças, in one line, worked out from what the server just read. Plain text: a
 * link one line tall is too small a target on a phone, and the attention list below links to
 * everything that needs doing.
 */
export function StatusLine({ status }: { status: DashboardMonth["status"] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { bank, taxMode } = status;

  let bankText: ReactNode;
  if (!bank) {
    bankText = t("statusNoBank");
  } else if (bank.expired) {
    bankText = (
      <span className="text-[var(--semantic-danger-readable)]">{t("statusConsentEnded")}</span>
    );
  } else {
    const synced = bank.lastSyncAt
      ? t("statusBankSynced", { date: formatDate(bank.lastSyncAt, locale) })
      : t("statusBankNeverSynced");
    const ending =
      bank.consentEndsAt && daysUntil(bank.consentEndsAt) <= CONSENT_WARNING_DAYS
        ? t("statusConsentEnding", { date: formatDate(bank.consentEndsAt, locale) })
        : null;
    bankText = (
      <>
        {synced}
        {ending ? (
          <>
            {" · "}
            <span className="text-[var(--semantic-warning-readable)]">{ending}</span>
          </>
        ) : null}
      </>
    );
  }

  const taxText = SIMULATED_MODES.has(taxMode)
    ? t("statusTaxSimulated")
    : TEST_MODES.has(taxMode)
      ? t("statusTaxTest")
      : t("statusTaxLive");

  return (
    <p className="text-sm text-[var(--color-muted-foreground)]" data-testid="dashboard-status">
      {bankText}
      {" · "}
      {taxText}
    </p>
  );
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
            owed && "text-[var(--semantic-danger)]",
          )}
        >
          {formatCurrency(figures.outstanding)}
        </p>
      </div>
    </div>
  );
}

/** Rendas → pagas → conciliadas → recibos → Finanças, each count opening where its work is. */
export function LoopStrip({ loop }: { loop: DashboardMonth["loop"] }) {
  const t = useTranslations("dashboard");

  const steps = [
    { key: "rents", label: t("loopRents"), count: loop.rents, href: LINKS.rentMatrix },
    { key: "paid", label: t("loopPaid"), count: loop.paid, href: LINKS.rentMatrix },
    { key: "reconciled", label: t("loopReconciled"), count: loop.reconciled, href: LINKS.bank },
    {
      key: "receipts",
      label: t("loopReceipts"),
      count: loop.receiptsIssued,
      href: LINKS.receipts,
      detail: t("loopReceiptsDetail", {
        issued: loop.receiptsIssued,
        toIssue: loop.receiptsToIssue,
      }),
    },
    { key: "filed", label: t("loopFiled"), count: loop.filed, href: LINKS.tax },
  ];

  return (
    <div className="panel">
      <SectionLabel>{t("loopTitle")}</SectionLabel>
      {loop.rents === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{t("loopEmpty")}</p>
      ) : (
        <>
          <ol className="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-5">
            {steps.map((step) => (
              <li key={step.key} className="bg-[var(--color-card)]">
                <Link
                  href={step.href}
                  className="flex h-full min-h-11 flex-col gap-1 px-4 py-3 hover:bg-[var(--color-muted)]"
                  data-step={step.key}
                >
                  <span className="text-xs text-[var(--color-muted-foreground)]">{step.label}</span>
                  <span className="text-lg font-light tabular-nums">{step.count}</span>
                  {step.detail ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {step.detail}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ol>
          <p className="border-t border-[var(--color-border)] px-4 py-3 text-sm">
            {t("loopTotal", { done: loop.fullyProcessed, total: loop.rents })}
          </p>
        </>
      )}
    </div>
  );
}

/** "Requer a sua atenção": shown only when something waits. */
export function AttentionList({ attention }: { attention: DashboardMonth["attention"] }) {
  const t = useTranslations("dashboard");
  const { formatCurrency } = useCurrency();

  const items = [
    attention.monthsOwed.count > 0 && {
      key: "owed",
      text: t("attentionOwed", {
        count: attention.monthsOwed.count,
        amount: formatCurrency(attention.monthsOwed.amount),
      }),
      href: LINKS.rentMatrix,
      tone: "danger" as const,
    },
    attention.movementsToReview > 0 && {
      key: "movements",
      text: t("attentionMovements", { count: attention.movementsToReview }),
      href: LINKS.bank,
      tone: "warning" as const,
    },
    attention.receiptsInDraft > 0 && {
      key: "receipts",
      text: t("attentionReceipts", { count: attention.receiptsInDraft }),
      href: LINKS.receipts,
      tone: "warning" as const,
    },
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
                className={cn(
                  item.tone === "danger" && "text-[var(--semantic-danger-readable)]",
                  item.tone === "warning" && "text-[var(--semantic-warning-readable)]",
                )}
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

/** The last bank movements, marked Processado or Rever; without a bank, the last payments. */
export function RecentMoney({ recent }: { recent: DashboardMonth["recent"] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  const bank = recent.source === "bank";

  return (
    <div className="panel">
      <SectionLabel
        action={<SeeAll href={bank ? LINKS.bank : LINKS.receipts}>{t("seeAll")}</SeeAll>}
      >
        {bank ? t("recentMovements") : t("recentPayments")}
      </SectionLabel>
      {recent.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          {bank ? t("recentMovementsEmpty") : t("recentPaymentsEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {recent.source === "bank"
            ? recent.items.map((movement) => (
                <li key={movement.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {movement.counterparty ?? t("unknownCounterparty")}
                    </p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDate(movement.date, locale)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(movement.amount)}
                    </span>
                    {movement.state === "processed" ? (
                      <span className="text-xs text-[var(--semantic-success-readable)]">
                        {t("movementProcessed")}
                      </span>
                    ) : movement.state === "review" ? (
                      <span className="text-xs text-[var(--semantic-warning-readable)]">
                        {t("movementToReview")}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))
            : recent.items.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{payment.tenantName}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDate(payment.date, locale)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatCurrency(payment.amount)}
                  </span>
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}

/** The portfolio as one line of text, not a panel of boxes. */
export function PortfolioLine({ portfolio }: { portfolio: DashboardMonth["portfolio"] }) {
  const t = useTranslations("dashboard");
  const percent =
    portfolio.properties > 0 ? Math.round((portfolio.occupied / portfolio.properties) * 100) : 0;

  return (
    <p className="text-sm text-[var(--color-muted-foreground)]" data-testid="dashboard-portfolio">
      {t("portfolioLine", {
        properties: portfolio.properties,
        occupied: portfolio.occupied,
        percent,
        ending: portfolio.leasesEnding,
      })}
    </p>
  );
}

/** The last five audit entries, and the way to the whole trail. */
export function RecentActivity({ activity }: { activity: DashboardMonth["activity"] }) {
  const t = useTranslations("dashboard");
  const tAction = useTranslations("auditActions");
  const locale = useLocale();

  return (
    <div className="panel">
      <SectionLabel action={<SeeAll href={LINKS.activity}>{t("activitySeeAll")}</SeeAll>}>
        {t("activityTitle")}
      </SectionLabel>
      {activity.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
          {t("activityEmpty")}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {activity.map((entry) => {
            const key = auditActionKey(entry.action);
            return (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate text-sm">
                  {key ? tAction(key) : entry.action}
                </span>
                <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                  {formatDateTime(entry.createdAt, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
