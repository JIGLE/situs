"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/lib/contexts/app-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import {
  NOTICE_DAYS,
  coefficientFor,
  fromMonthValue,
  increasedRent,
  rentIncreaseWarnings,
  suggestedStartMonth,
  toMonthValue,
  type IncreaseBasis,
} from "@/lib/utils/rent-increase";
import type { Lease } from "@/lib/types";

/** Today as `YYYY-MM-DD`, the value of an `<input type="date">`. */
function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What the next update counts its year from: the start, or the last increase that took effect. */
function basisOf(lease: Lease): IncreaseBasis {
  const applied = (lease.rentIncreases ?? []).filter((i) => i.appliedAt);
  const last = applied[applied.length - 1];
  return {
    startDate: new Date(lease.startDate),
    lastIncreaseFrom: last ? new Date(last.effectiveFrom) : null,
  };
}

/** The increase on this lease still waiting for its month, if any. */
export function pendingIncrease(lease: Lease) {
  return (lease.rentIncreases ?? []).find((i) => !i.appliedAt) ?? null;
}

/**
 * **Rent increase** for the selected leases. Each new rent starts in a month the owner picks,
 * suggested as the first one a year after the start (or the last increase) that leaves 30 days'
 * notice; the percentage defaults to INE's coefficient for the year. It used to write the new rent
 * onto the lease at once, so it applied before the tenant could have been told.
 */
export function RentIncreaseDialog({
  open,
  onOpenChange,
  leases,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leases: Lease[];
  onScheduled?: () => void;
}) {
  const t = useTranslations("leases.rentIncrease");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  const { state, refreshData } = useApp();
  const { token: csrfToken } = useCsrf();
  const { success, error } = useToast();
  const explain = useApiError();

  const year = new Date().getUTCFullYear();
  const suggestedPercent = coefficientFor(year);
  const [percent, setPercent] = useState(suggestedPercent ? String(suggestedPercent) : "");
  const [noticeDate, setNoticeDate] = useState(todayValue);
  const [months, setMonths] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const notice = useMemo(() => new Date(`${noticeDate}T00:00:00.000Z`), [noticeDate]);
  const pct = parseFloat(percent);
  const validPct = !isNaN(pct) && pct > 0 && pct <= 100;

  // Each lease's month follows the notice date until the owner picks one.
  useEffect(() => {
    if (!open) return;
    setMonths({});
  }, [open, noticeDate]);

  const rows = leases.map((lease) => {
    const pending = pendingIncrease(lease);
    const basis = basisOf(lease);
    const value = months[lease.id] ?? toMonthValue(suggestedStartMonth(basis, notice));
    const from = fromMonthValue(value);
    const tenant = state.tenants.find((x) => x.id === lease.tenantId);
    const property = state.properties.find((x) => x.id === lease.propertyId);
    return {
      lease,
      pending,
      value,
      from,
      tenantName: tenant?.name ?? lease.tenant?.name ?? "—",
      address: property?.address ?? lease.property?.address ?? "",
      newRent: validPct ? increasedRent(lease.monthlyRent, pct) : null,
      warnings: from ? rentIncreaseWarnings(basis, notice, from) : [],
    };
  });
  const ready = rows.filter((row) => !row.pending && row.from);

  const monthLabel = (from: Date) =>
    formatMonthYear(from.getUTCFullYear(), from.getUTCMonth() + 1, locale);

  const handleSchedule = async () => {
    if (!validPct || ready.length === 0) return;
    setSaving(true);
    let done = 0;
    try {
      for (const row of ready) {
        await apiFetch(`/api/leases/${row.lease.id}/rent-increases`, csrfToken, "POST", {
          effectiveFrom: row.value,
          percent: pct,
          noticeDate,
        });
        done += 1;
      }
      success(t("scheduled", { count: done }));
      onOpenChange(false);
      onScheduled?.();
    } catch (err) {
      error(explain(err));
    } finally {
      setSaving(false);
      if (done > 0) await refreshData();
    }
  };

  const handleDownloadNotices = () => {
    if (!validPct) return;
    const lines: string[] = [];
    for (const row of ready) {
      if (!row.from || row.newRent === null) continue;
      lines.push(
        formatDate(notice, locale),
        "",
        t("notice.greeting", { name: row.tenantName }),
        "",
        t("notice.body", {
          address: row.address,
          percent: pct,
          year: row.from.getUTCFullYear(),
        }),
        "",
        t("notice.current", { amount: formatCurrency(row.lease.monthlyRent) }),
        t("notice.new", { amount: formatCurrency(row.newRent) }),
        t("notice.from", { month: monthLabel(row.from) }),
        "",
        t("notice.closing"),
        "",
        "─".repeat(60),
        "",
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rent-increase-notices-${noticeDate}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { days: NOTICE_DAYS })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rent-increase-pct">{t("percent")}</Label>
              <Input
                id="rent-increase-pct"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
              {suggestedPercent ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {t("coefficientHint", { year, percent: suggestedPercent })}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rent-increase-notice">{t("noticeDate")}</Label>
              <Input
                id="rent-increase-notice"
                type="date"
                value={noticeDate}
                onChange={(e) => setNoticeDate(e.target.value || todayValue())}
              />
            </div>
          </div>

          <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] text-sm">
            {rows.map((row) => (
              <li key={row.lease.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium break-words">{row.tenantName}</span>
                  <span className="tabular-nums">
                    {formatCurrency(row.lease.monthlyRent)}
                    {row.newRent !== null && !row.pending ? (
                      <>
                        {" → "}
                        <strong>{formatCurrency(row.newRent)}</strong>
                      </>
                    ) : null}
                  </span>
                </div>
                {row.pending ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t("alreadyPending", {
                      amount: formatCurrency(row.pending.newRent),
                      month: monthLabel(new Date(row.pending.effectiveFrom)),
                    })}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Label
                        htmlFor={`rent-increase-from-${row.lease.id}`}
                        className="text-xs text-[var(--color-muted-foreground)]"
                      >
                        {t("startsIn")}
                      </Label>
                      <Input
                        id={`rent-increase-from-${row.lease.id}`}
                        type="month"
                        className="w-auto"
                        value={row.value}
                        onChange={(e) =>
                          setMonths((current) => ({ ...current, [row.lease.id]: e.target.value }))
                        }
                      />
                    </div>
                    {row.warnings.map((warning) => (
                      <p key={warning} className="text-xs text-[var(--semantic-warning-readable)]">
                        {warning === "short_notice"
                          ? t("warning.shortNotice", { days: NOTICE_DAYS })
                          : t("warning.beforeAnniversary")}
                      </p>
                    ))}
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleDownloadNotices}
              disabled={!validPct || ready.length === 0}
            >
              <Mail className="mr-1.5 h-4 w-4" />
              {t("downloadNotices")}
            </Button>
            <Button
              onClick={handleSchedule}
              loading={saving}
              disabled={!validPct || ready.length === 0}
            >
              {t("schedule")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
