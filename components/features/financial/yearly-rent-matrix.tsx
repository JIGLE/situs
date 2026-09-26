"use client";

import * as React from "react";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RentMatrix, RentMatrixRow } from "@/lib/services/allocation/rent-matrix";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatEuro } from "@/lib/utils/currency";
import { formatMonth, formatMonthYear } from "@/lib/utils/format-date";
import { rentPeriodStatusKey } from "@/lib/utils/rent-period-labels";
import { cn } from "@/lib/utils/utils";
import { RentMonthSheet, monthParam, parseMonthParam, type MonthRef } from "./rent-month-sheet";
import { CELL_ICONS, CELL_STYLES, LEGEND_STATUSES } from "./rent-status-styles";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** The tenant column stays put while the months scroll under it (responsive rule 3). */
const STICKY = "sticky left-0 z-10 bg-[var(--color-card-solid)]";

/** What a month still owes, shown in its cell only while it is owed. */
const SHOWS_OWED = new Set(["partially_paid", "overdue", "due"]);

const WHOLE_EUROS = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
const compactEuro = (amount: number) => `€${WHOLE_EUROS.format(amount)}`;

/** Replaces the address's query without a navigation: Next keeps `useSearchParams` in step. */
function writeMonthParam(value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set("month", value);
  else params.delete("month");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

/**
 * Who has paid, month by month. Each cell is one lease's reference month, coloured and marked by
 * what the ledger says of it now, with what is still owed; tapping it opens the month. The
 * tenant column stays fixed while the months scroll on a phone.
 */
interface Props {
  /** Changes when a payment is recorded elsewhere on the page, so the ledger is read again. */
  ledgerVersion?: number;
}

export function YearlyRentMatrix({ ledgerVersion = 0 }: Props): React.ReactElement {
  const apiError = useApiError();
  const t = useTranslations("financial.matrix");
  const tCommon = useTranslations("common");
  const tPeriod = useTranslations("rentPeriodStatus");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(() => {
    const opened = parseMonthParam(searchParams.get("month"));
    return opened?.year ?? new Date().getUTCFullYear();
  });
  const [matrix, setMatrix] = useState<RentMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The month keeps its place while the sheet closes, so it leaves with its content.
  const [sheet, setSheet] = useState<{ month: MonthRef; open: boolean } | null>(() => {
    const month = parseMonthParam(searchParams.get("month"));
    return month ? { month, open: true } : null;
  });

  const now = new Date();
  const currentMonth = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : null;

  const load = useCallback(
    async (y: number, quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        setMatrix(await apiFetch<RentMatrix>(`/api/finance/rent-matrix?year=${y}`));
      } catch (err) {
        setError(apiError(err));
        if (!quiet) setMatrix(null);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [apiError],
  );

  useEffect(() => {
    void load(year);
  }, [year, load]);

  // A payment recorded from the page header: read the ledger again without the loading state.
  const reread = useEffectEvent(() => void load(year, true));
  useEffect(() => {
    if (ledgerVersion > 0) reread();
  }, [ledgerVersion]);

  function open(row: RentMatrixRow, month: number) {
    const ref = { leaseId: row.leaseId, year, month };
    setSheet({ month: ref, open: true });
    writeMonthParam(monthParam(ref));
  }

  function close() {
    setSheet((shown) => shown && { ...shown, open: false });
    writeMonthParam(null);
  }

  const statusLabel = (status: string) => {
    const key = rentPeriodStatusKey(status);
    return key ? tPeriod(key) : status;
  };

  function renderCell(row: RentMatrixRow, month: number) {
    const cell = row.months[month];
    if (!cell) {
      return (
        <span className="inline-block w-full text-[var(--color-muted-foreground)]" aria-hidden>
          —
        </span>
      );
    }
    const Icon = CELL_ICONS[cell.status];
    const owed = SHOWS_OWED.has(cell.status) && cell.outstanding > 0;
    return (
      <button
        type="button"
        onClick={() => open(row, month)}
        aria-label={t("cellLabel", {
          month: formatMonthYear(year, month, locale),
          status: statusLabel(cell.status),
          paid: formatEuro(cell.allocatedAmount),
          due: formatEuro(cell.dueAmount),
        })}
        className={cn(
          "inline-flex h-11 w-full min-w-11 flex-col items-center justify-center gap-0.5 px-1 text-xs transition-colors hover:brightness-95 md:h-9",
          CELL_STYLES[cell.status] ?? "",
          month === currentMonth && "ring-1 ring-inset ring-[var(--color-foreground)]/40",
        )}
      >
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : <span aria-hidden>·</span>}
        {owed ? (
          <span className="leading-none tabular-nums">{compactEuro(cell.outstanding)}</span>
        ) : null}
      </button>
    );
  }

  const rows = matrix?.rows ?? [];

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* No heading: the tab label is this view's heading. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setYear((y) => y - 1)}
            aria-label={tCommon("previousYear")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-12 text-center text-sm font-medium tabular-nums">{year}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setYear((y) => y + 1)}
            aria-label={tCommon("nextYear")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
          {LEGEND_STATUSES.map((status) => {
            const Icon = CELL_ICONS[status];
            return (
              <li key={status} className="flex items-center gap-1">
                <span
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center",
                    CELL_STYLES[status],
                  )}
                  aria-hidden
                >
                  {Icon ? <Icon className="h-3 w-3" /> : "·"}
                </span>
                {statusLabel(status)}
              </li>
            );
          })}
        </ul>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">{tCommon("loading")}</p>
      ) : error ? (
        <p role="alert" className="p-6 text-sm text-[var(--semantic-danger-readable)]">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">{t("empty", { year })}</p>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th
                  scope="col"
                  className={cn(
                    STICKY,
                    "min-w-36 px-3 py-2 text-left text-xs font-medium text-[var(--color-muted-foreground)]",
                  )}
                >
                  {tCommon("contract")}
                </th>
                {MONTHS.map((month) => (
                  <th
                    key={month}
                    scope="col"
                    aria-current={month === currentMonth ? "date" : undefined}
                    className={cn(
                      "min-w-12 px-0.5 py-2 text-center text-xs font-medium capitalize text-[var(--color-muted-foreground)]",
                      month === currentMonth &&
                        "text-[var(--color-foreground)] underline underline-offset-4",
                    )}
                  >
                    {formatMonth(year, month, locale)}
                  </th>
                ))}
                <th
                  scope="col"
                  className="min-w-24 px-3 py-2 text-right text-xs font-medium text-[var(--color-muted-foreground)]"
                >
                  {t("yearTotal")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.leaseId} className="border-b border-[var(--color-border)]">
                  <th scope="row" className={cn(STICKY, "px-3 py-1 text-left font-normal")}>
                    <Link
                      href={`/leases/${row.leaseId}`}
                      className="flex min-h-11 max-w-40 flex-col justify-center hover:underline md:min-h-9"
                    >
                      <span className="truncate font-medium text-[var(--color-foreground)]">
                        {row.tenantName}
                      </span>
                      <span className="truncate text-xs text-[var(--color-muted-foreground)]">
                        {row.propertyName}
                      </span>
                    </Link>
                  </th>
                  {MONTHS.map((month) => (
                    <td key={month} className="px-0.5 py-1 text-center">
                      {renderCell(row, month)}
                    </td>
                  ))}
                  <td className="px-3 py-1 text-right text-xs tabular-nums">
                    <span className="block text-[var(--color-foreground)]">
                      {formatEuro(row.totals.received)}
                    </span>
                    <span className="block text-[var(--color-muted-foreground)]">
                      {t("ofExpected", { amount: formatEuro(row.totals.expected) })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th
                  scope="row"
                  className={cn(
                    STICKY,
                    "px-3 py-2 text-left text-xs font-medium text-[var(--color-muted-foreground)]",
                  )}
                >
                  {t("received")}
                </th>
                {MONTHS.map((month) => {
                  const total = matrix?.totals.months[month];
                  return (
                    <td key={month} className="px-0.5 py-2 text-center text-xs tabular-nums">
                      {total ? (
                        <>
                          <span className="block text-[var(--color-foreground)]">
                            {compactEuro(total.received)}
                          </span>
                          <span className="block text-[var(--color-muted-foreground)]">
                            {t("ofExpected", { amount: compactEuro(total.expected) })}
                          </span>
                        </>
                      ) : (
                        <span aria-hidden>—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right text-xs tabular-nums">
                  <span className="block font-medium text-[var(--color-foreground)]">
                    {formatEuro(matrix?.totals.received ?? 0)}
                  </span>
                  <span className="block text-[var(--color-muted-foreground)]">
                    {t("ofExpected", { amount: formatEuro(matrix?.totals.expected ?? 0) })}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <RentMonthSheet
        monthRef={sheet?.month ?? null}
        open={sheet?.open ?? false}
        onClose={close}
        onChanged={() => void load(year, true)}
      />
    </div>
  );
}
