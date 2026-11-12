"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import type { RentHistory } from "@/lib/services/leases/rent-history";
import { monthsBetween, plannedMonths } from "./rent-history-plan";

export interface RentHistorySheetProps {
  /** The tenancy just saved; null keeps the sheet closed. */
  leaseId: string | null;
  monthlyRent: number;
  history: RentHistory | null;
  onClose: () => void;
}

const currentMonth = (now = new Date()) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

const label = (key: string, locale: string) =>
  formatMonthYear(Number(key.slice(0, 4)), Number(key.slice(5, 7)), locale);

/**
 * After a tenancy that began before today is saved: from which month Situs tracks its rent (the
 * months before count as paid before Situs), and which bank movements already in were its rent.
 * Each one ticked is confirmed as the inbox's Confirm would, so it is allocated and the payer's
 * account is remembered for the months to come.
 */
export function RentHistorySheet({
  leaseId,
  monthlyRent,
  history,
  onClose,
}: RentHistorySheetProps) {
  const t = useTranslations("leases.history");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  const { refreshData } = useApp();
  const { success, error } = useToast();
  const apiError = useApiError();

  const now = currentMonth();
  const options = useMemo(
    () => (history ? monthsBetween(history.startMonth, now) : []),
    [history, now],
  );

  const [from, setFrom] = useState(now);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!history) return;
    const likely = history.suggestions.filter((s) => s.likely);
    setTicked(new Set(likely.map((s) => s.transactionId)));
    // Tracked from the first month the bank shows this rent arriving, else from this month.
    const first = likely[0]?.bookingDate.slice(0, 7);
    setFrom(first && first >= history.startMonth && first <= now ? first : now);
  }, [history, now]);

  const chosen = (history?.suggestions ?? []).filter((s) => ticked.has(s.transactionId));
  const pays = plannedMonths(
    (history?.openMonths ?? []).filter((m) => m.month >= from),
    chosen.map((s) => s.amount),
    monthlyRent,
    from,
  );

  const handleSave = async () => {
    if (!leaseId || !history) return;
    setSaving(true);
    let recorded = 0;
    try {
      if (from > history.startMonth) {
        await apiFetch(`/api/leases/${leaseId}/rent-history`, {
          method: "POST",
          body: JSON.stringify({ from }),
        });
      }
      // Oldest first: each fills the oldest month still owing, as the ledger's waterfall does.
      for (const suggestion of chosen) {
        const result = await apiFetch<{ status: string }>(
          `/api/bank/transactions/${suggestion.transactionId}`,
          { method: "PUT", body: JSON.stringify({ action: "confirm", leaseId }) },
        );
        if (result?.status === "matched_confirmed") recorded += 1;
      }
      success(t("saved", { count: recorded }));
      onClose();
    } catch (err) {
      error(apiError(err));
    } finally {
      await refreshData();
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!leaseId && !!history} onOpenChange={(open) => !open && !saving && onClose()}>
      <SheetContent side="center" className="md:max-w-xl">
        <SheetHeader className="pr-14">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="rent-history-from">{t("from")}</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="rent-history-from" className="md:w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((month) => (
                  <SelectItem key={month} value={month}>
                    {label(month, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {history && from > history.startMonth && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {t("fromHint", { month: label(from, locale) })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("movements")}</p>
            {history && history.suggestions.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("none")}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                {(history?.suggestions ?? []).map((s) => {
                  const index = chosen.indexOf(s);
                  const month = index >= 0 ? pays[index] : null;
                  return (
                    <li key={s.transactionId} className="flex items-start gap-3 py-3">
                      <Checkbox
                        checked={ticked.has(s.transactionId)}
                        onCheckedChange={(checked) =>
                          setTicked((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(s.transactionId);
                            else next.delete(s.transactionId);
                            return next;
                          })
                        }
                        aria-label={t("include", {
                          date: formatDate(s.bookingDate, locale),
                          amount: formatCurrency(s.amount),
                        })}
                        wrapperClassName="mt-0.5 max-md:min-h-11 max-md:min-w-11 max-md:mt-0 justify-center"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="flex flex-wrap justify-between gap-x-3">
                          <span className="font-medium">
                            {formatDate(s.bookingDate, locale)} · {formatCurrency(s.amount)}
                          </span>
                          {month && (
                            <span className="text-[var(--color-muted-foreground)]">
                              {t("pays", { month: label(month, locale) })}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                          {[s.counterpartyName, s.reference].filter(Boolean).join(" · ") ||
                            t("unknownPayer")}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {t("skip")}
          </Button>
          <Button type="button" onClick={handleSave} loading={saving} disabled={saving}>
            {t("save")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
