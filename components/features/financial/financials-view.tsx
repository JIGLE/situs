"use client";

import { useMemo, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/lib/contexts/currency-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/lib/contexts/app-context";
import { cn } from "@/lib/utils/utils";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { incomeTotal } from "@/lib/utils/receipt-income";

type Range = "all" | "month" | "year";

/** Whether a date falls in this month, this year, or at all. */
function inRange(raw: string, range: Range, now: Date): boolean {
  if (range === "all") return true;
  const date = new Date(raw);
  if (date.getFullYear() !== now.getFullYear()) return false;
  return range === "year" || date.getMonth() === now.getMonth();
}

/**
 * Finance › Reports' first line: income, expenses and what is left, for this month, this year or
 * all time. It also listed every receipt by month and every expense, with its own Add expense;
 * the receipts register below it and the Expenses tab now hold those.
 */
export function FinancialsView(): React.ReactElement {
  const { state } = useApp();
  const { receipts, expenses, loading } = state;
  const { formatCurrency } = useCurrency();
  const t = useTranslations("financial");
  const [timeRange, setTimeRange] = useState<Range>("month");

  const metrics = useMemo(() => {
    const now = new Date();
    const totalIncome = incomeTotal(receipts.filter((r) => inRange(r.date, timeRange, now)));
    const totalExpenses = expenses
      .filter((e) => inRange(e.date, timeRange, now))
      .reduce((sum, expense) => sum + expense.amount, 0);
    return { totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses };
  }, [receipts, expenses, timeRange]);

  return (
    <>
      {loading ? (
        <LoadingState variant="cards" count={6} />
      ) : receipts.length === 0 && expenses.length === 0 ? (
        <div className="space-y-4">
          <h2 className="mono-label">{t("title")}</h2>
          <EmptyStateIllustration
            type="expenses"
            title={t("noFinancialData")}
            description={t("noFinancialDataDesc")}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* A section label and one line of figures: counts as text, not tiles (density
              rules 2 and 4). */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="mono-label">{t("title")}</h2>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {t("totalIncome")}{" "}
                <span className="tabular-nums text-[var(--color-foreground)]">
                  {formatCurrency(metrics.totalIncome)}
                </span>
                {" · "}
                {t("totalExpenses")}{" "}
                <span className="tabular-nums text-[var(--color-foreground)]">
                  {formatCurrency(metrics.totalExpenses)}
                </span>
                {" · "}
                {t("netIncome")}{" "}
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    metrics.netProfit >= 0
                      ? "text-[var(--semantic-success-readable)]"
                      : "text-[var(--semantic-danger-readable)]",
                  )}
                >
                  {formatCurrency(metrics.netProfit)}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={timeRange} onValueChange={(value) => setTimeRange(value as Range)}>
                {/* Content-sized with a floor. At a fixed 150px the value overflowed its own box
                  by 3px — enough for the audit to count it as an unreachable clip, and a sign
                  the width was guessed rather than measured. */}
                <SelectTrigger className="min-w-[150px] w-auto" aria-label={t("timeRange")}>
                  <CalendarIcon className="w-4 h-4 shrink-0" />
                  <SelectValue placeholder={t("timeRange")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTime")}</SelectItem>
                  <SelectItem value="month">{t("thisMonth")}</SelectItem>
                  <SelectItem value="year">{t("thisYear")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
