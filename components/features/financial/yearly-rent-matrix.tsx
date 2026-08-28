"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Situs Yearly Rent Overview — the contract × 12-month payment matrix.
 * Reads the RentPeriod ledger (Migration A): every cell is a persisted-derived
 * reference-month status, so lateness and partials are facts, not inference.
 */

interface MatrixCell {
  status: string;
  dueAmount: number;
  allocatedAmount: number;
}

interface MatrixRow {
  leaseId: string;
  tenantName: string;
  propertyName: string;
  months: Record<number, MatrixCell | undefined>;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CELL_STYLES: Record<string, string> = {
  paid: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  paid_late: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  partially_paid: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  overdue: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  due: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  upcoming: "text-[var(--color-muted-foreground)]",
  waived: "text-[var(--color-muted-foreground)] line-through",
};

const CELL_CODES: Record<string, string> = {
  paid: "PAID",
  paid_late: "LATE",
  partially_paid: "PART",
  overdue: "OVDU",
  due: "DUE",
  upcoming: "—",
  waived: "WVD",
};

export function YearlyRentMatrix(): React.ReactElement {
  const t = useTranslations("common");
  // The cell itself shows a four-letter code (PAID/LATE/PART) by design; the tooltip is the
  // place the state gets said in words, and it was saying the stored enum.
  const tPeriod = useTranslations("rentPeriodStatus");
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/rent-matrix?year=${y}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = await res.json();
      setRows(body?.data?.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rent matrix");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year);
  }, [year, load]);

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
        <p className="mono-label">Yearly rent overview · contract payment matrix</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            onClick={() => setYear((y) => y - 1)}
            aria-label={t("previousYear")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="font-mono text-sm tabular-nums">{year}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            onClick={() => setYear((y) => y + 1)}
            aria-label={t("nextYear")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : error ? (
        <p className="p-6 text-sm text-[var(--semantic-danger-readable)]">{error}</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
          No rent periods for {year}. Periods are generated when a lease is created — run the
          backfill script for existing leases.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="mono-label border-b border-[var(--color-border)] px-4 py-2 text-left font-normal">
                  {t("contract")}
                </th>
                {MONTH_LABELS.map((m) => (
                  <th
                    key={m}
                    className="mono-label border-b border-[var(--color-border)] px-2 py-2 text-center font-normal"
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.leaseId} className="hover:bg-[var(--color-hover)]">
                  <td className="border-b border-[var(--color-border)] px-4 py-2.5">
                    <span className="block truncate font-medium">{row.tenantName}</span>
                    <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                      {row.propertyName}
                    </span>
                  </td>
                  {MONTH_LABELS.map((_, i) => {
                    const cell = row.months[i + 1];
                    return (
                      <td
                        key={i}
                        className="border-b border-[var(--color-border)] px-1 py-2.5 text-center"
                        title={
                          cell
                            ? `${tPeriod(cell.status)} · ${cell.allocatedAmount.toFixed(2)} / ${cell.dueAmount.toFixed(2)}`
                            : undefined
                        }
                      >
                        <span
                          className={`inline-block min-w-[42px] px-1 py-0.5 font-mono text-[12px] md:text-[10px] uppercase tracking-[0.04em] ${
                            cell
                              ? (CELL_STYLES[cell.status] ?? "")
                              : "text-[var(--color-muted-foreground)]"
                          }`}
                        >
                          {cell ? (CELL_CODES[cell.status] ?? cell.status) : "·"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
