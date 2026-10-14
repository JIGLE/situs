"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  PropertyCurrentPeriod,
  PropertyYearStrip as PropertyYearStripData,
} from "@/lib/hooks/use-property-activity";

/** One reference-month cell, as handed to `onSelectMonth`. */
export interface YearStripSelection {
  year: number;
  month: number;
  label: string;
  status: string | null;
  dueAmount: number;
  allocatedAmount: number;
}

interface PropertyYearStripProps {
  propertyId: string;
  /** The current year's strip, already fetched by the parent's usePropertyActivity(propertyId) call. */
  defaultYearStrip: PropertyYearStripData;
  currentPeriod: PropertyCurrentPeriod | null;
  receiptLifecycle: string | null;
  /** Opens the reference-month detail. Cells are inert (and unfocusable) without it. */
  onSelectMonth?: (selection: YearStripSelection) => void;
}

const MONTH_LABELS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// Same status vocabulary + semantic tokens as YearlyRentMatrix (Finance > Rent
// Matrix) — a property's ledger cell means the same thing everywhere it
// appears. paid_late and partially_paid share a color there too (the wider
// table cell disambiguates via a 4-letter code instead) — this reuses the
// same convention rather than inventing a new one; the tooltip + legend here
// carry the disambiguation instead of a text code.
const STATUS_SWATCH: Record<string, string> = {
  paid: "bg-[var(--semantic-success-soft)] border-[var(--semantic-success-readable)]",
  paid_late: "bg-[var(--semantic-warning-soft)] border-[var(--semantic-warning-readable)]",
  partially_paid: "bg-[var(--semantic-warning-soft)] border-[var(--semantic-warning-readable)]",
  overdue: "bg-[var(--semantic-danger-soft)] border-[var(--semantic-danger-readable)]",
  due: "border-[var(--semantic-warning-readable)]",
  waived: "border-[var(--color-border)] opacity-60",
};

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  paid_late: "Paid late",
  partially_paid: "Partial",
  overdue: "Overdue",
  due: "Due",
  waived: "Waived",
};

const LEGEND_ORDER = ["paid", "paid_late", "partially_paid", "due", "overdue", "waived"];

/**
 * Year-at-a-glance rent ledger for a single property — 12 reference-month
 * cells from the RentPeriod ledger (same data/status vocabulary as the
 * portfolio-wide YearlyRentMatrix, scoped to this property). Replaces the
 * old text-only "Current Period Status" band with a visual history plus the
 * same current-period summary line.
 */
export function PropertyYearStrip({
  propertyId,
  defaultYearStrip,
  currentPeriod,
  receiptLifecycle,
  onSelectMonth,
}: PropertyYearStripProps) {
  const t = useTranslations("common");
  const defaultYear = defaultYearStrip.year;
  const [year, setYear] = useState(defaultYear);
  const [strip, setStrip] = useState(defaultYearStrip);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (year === defaultYear) {
      setStrip(defaultYearStrip);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/properties/${propertyId}/activity?year=${year}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.data?.yearStrip) setStrip(body.data.yearStrip);
      })
      .catch(() => {
        // A failed year-nav fetch just leaves the previous strip on screen.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, defaultYear, propertyId, defaultYearStrip]);

  const isCurrentYear = year === defaultYear;

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="mono-label">Rent ledger · reference months</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setYear((y) => y - 1)}
            aria-label={t("previousYear")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="font-mono text-sm tabular-nums">{year}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setYear((y) => y + 1)}
            aria-label={t("nextYear")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        className={`mt-3 grid grid-cols-6 gap-2 sm:grid-cols-12 ${loading ? "opacity-50 transition-opacity" : ""}`}
      >
        {MONTH_LABELS.map((label, i) => {
          const month = i + 1;
          const cell = strip.months[month];
          const isCurrentCell = isCurrentYear && currentPeriod?.month === month;
          const summary = cell
            ? `${STATUS_LABEL[cell.status] ?? cell.status} · €${cell.allocatedAmount.toFixed(2)} / €${cell.dueAmount.toFixed(2)}`
            : "No period";
          const swatch = `mx-auto mt-1 block h-3.5 w-3.5 border ${
            cell
              ? (STATUS_SWATCH[cell.status] ?? "border-[var(--color-border)]")
              : "border-dashed border-[var(--color-border)] opacity-40"
          }`;
          const outline = isCurrentCell
            ? "text-center outline outline-1 outline-offset-2 outline-[var(--color-foreground)]"
            : "text-center";

          // Inert when the parent supplies no handler, so this stays a pure visual strip
          // wherever it is reused.
          if (!onSelectMonth) {
            return (
              <div key={month} className={outline}>
                <span className="mono-label block text-tick">{label}</span>
                <span className={swatch} title={summary} />
              </div>
            );
          }

          return (
            <button
              key={month}
              type="button"
              onClick={() =>
                onSelectMonth({
                  year,
                  month,
                  label,
                  status: cell?.status ?? null,
                  dueAmount: cell?.dueAmount ?? 0,
                  allocatedAmount: cell?.allocatedAmount ?? 0,
                })
              }
              title={summary}
              aria-label={`${label} ${year} — ${summary}`}
              className={`${outline} py-1 transition-colors hover:bg-[var(--color-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] max-md:min-h-11`}
            >
              <span className="mono-label block text-tick">{label}</span>
              <span className={swatch} />
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2">
        {LEGEND_ORDER.map((status) => (
          <span
            key={status}
            className="mono-label flex items-center gap-1.5 text-tick text-[var(--color-muted-foreground)]"
          >
            <span className={`inline-block h-2.5 w-2.5 border ${STATUS_SWATCH[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>

      {isCurrentYear && currentPeriod && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted-foreground)]">
          <span className="mono-label text-[var(--color-foreground)]">
            Current: {String(currentPeriod.month).padStart(2, "0")}/{currentPeriod.year}
          </span>
          <span className="tabular-nums">
            €{currentPeriod.allocatedAmount.toFixed(2)} / €{currentPeriod.dueAmount.toFixed(2)}{" "}
            allocated
          </span>
          <span>receipt: {receiptLifecycle ? receiptLifecycle.replace(/_/g, " ") : "—"}</span>
        </div>
      )}
    </div>
  );
}
