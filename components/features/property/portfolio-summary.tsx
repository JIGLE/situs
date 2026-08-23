"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarClock, CheckCircle2, Wrench } from "lucide-react";

import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";

/**
 * What the Portfolio workspace shows before an asset is chosen.
 *
 * It used to show a dashed box containing one centred line — "select an asset". On a 1440px
 * screen the rightmost painted thing was a 26-character sentence, and the audit measured the
 * page's content at 69% of the window against 94–95% everywhere else, with a 373px run of
 * nothing. Both numbers were describing the same fact: the screen answered nothing until you
 * clicked something.
 *
 * So the default state answers the question you open Portfolio to ask. Three figures, then the
 * assets that need a decision, each one a way into its own workspace rather than a dead end.
 *
 * ── Why a divided list and not a grid of cards ───────────────────────────────────────────────
 * The same reason `components/features/admin/system-status-view.tsx` gives, and this follows its
 * pattern deliberately: a card per row puts a border, a shadow and a hover-lift on every item of
 * a list whose whole job is to be scanned, and makes the one row that needs attention look
 * exactly like the ones that do not. Hairline dividers and a severity rule down the left edge
 * can be read as a column without reading a word.
 */

type Severity = "danger" | "warning";

const SEVERITY_RULE: Record<Severity, string> = {
  // The `-readable` variants, not the raw hues: raw `--semantic-warning` on the dark theme's
  // panel is a rule you have to hunt for.
  danger: "bg-[var(--semantic-danger-readable)]",
  warning: "bg-[var(--semantic-warning-readable)]",
};

const SEVERITY_TEXT: Record<Severity, string> = {
  danger: "text-[var(--semantic-danger-readable)]",
  warning: "text-[var(--semantic-warning-readable)]",
};

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 flex-1 border-l border-[var(--color-inner-border)] px-4 py-3 first:border-l-0">
      <div className="mono-label">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums tracking-tight text-[var(--color-foreground)]">
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">{detail}</div>
    </div>
  );
}

export function PortfolioSummary({
  onSelectProperty,
}: {
  onSelectProperty?: (propertyId: string) => void;
}): React.ReactElement {
  const { state } = useApp();
  const { formatCurrency } = useCurrency();
  const t = useTranslations("portfolio");
  const { properties, leases, maintenance, receipts } = state;

  const occupied = properties.filter((p) => p.status === "occupied").length;
  const occupancyRate = properties.length ? Math.round((occupied / properties.length) * 100) : 0;
  const monthlyRunRate = properties.reduce((sum, p) => sum + (p.rent || 0), 0);

  const lastMonthTotal = useMemo(() => {
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    return receipts
      .filter((r) => {
        if (r.status !== "paid") return false;
        const d = new Date((r as unknown as { date?: string }).date ?? r.createdAt);
        return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
      })
      .reduce((sum, r) => sum + r.amount, 0);
  }, [receipts]);

  /**
   * One entry per asset that needs a decision, worst reason first.
   *
   * The three conditions are the ones the tree's "attention only" filter already counts, so the
   * badge on the rail and this list can never disagree about what is wrong.
   */
  const attention = useMemo(() => {
    const now = new Date();
    const inThirtyDays = new Date();
    inThirtyDays.setDate(inThirtyDays.getDate() + 30);

    const activeLeaseIds = new Set(
      leases.filter((l) => l.status === "active").map((l) => l.propertyId),
    );

    return properties
      .map((property) => {
        const openTickets = maintenance.filter(
          (m) =>
            m.propertyId === property.id && (m.status === "open" || m.status === "in_progress"),
        ).length;

        const expiring = leases.find((l) => {
          if (l.propertyId !== property.id || l.status !== "active") return false;
          const end = new Date(l.endDate);
          return end >= now && end <= inThirtyDays;
        });

        const occupiedNoLease = property.status === "occupied" && !activeLeaseIds.has(property.id);

        // Ordered by what costs most to ignore: a tenancy with no contract behind it, then a
        // lease about to lapse, then work outstanding.
        if (occupiedNoLease) {
          return {
            id: property.id,
            name: property.name,
            severity: "danger" as Severity,
            Icon: AlertTriangle,
            reason: t("summary.noActiveLease"),
          };
        }
        if (expiring) {
          return {
            id: property.id,
            name: property.name,
            severity: "warning" as Severity,
            Icon: CalendarClock,
            reason: t("summary.leaseEnding", {
              date: new Date(expiring.endDate).toLocaleDateString(),
            }),
          };
        }
        if (openTickets > 0) {
          return {
            id: property.id,
            name: property.name,
            severity: "warning" as Severity,
            Icon: Wrench,
            reason: t("attention.openTickets", { count: openTickets }),
          };
        }
        return null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [leases, maintenance, properties, t]);

  const delta = monthlyRunRate - lastMonthTotal;

  return (
    <div className="space-y-4">
      {/* One stat row, three figures. The declutter rule in CLAUDE.md caps this at three or four
          and forbids a second row; these are the three that used to sit in the page header's
          subtitle, which is why they no longer do. */}
      <div className="flex flex-wrap border border-[var(--color-inner-border)] bg-[var(--color-surface-solid)]">
        <Stat
          label={t("stats.trackedUnits")}
          value={String(properties.length)}
          detail={t("stats.occupied", { count: occupied })}
        />
        <Stat
          label={t("stats.occupancy")}
          value={`${occupancyRate}%`}
          detail={t("stats.vacancySlots", { count: properties.length - occupied })}
        />
        <Stat
          label={t("stats.runRate")}
          value={formatCurrency(monthlyRunRate)}
          detail={
            lastMonthTotal > 0
              ? `${delta >= 0 ? "+" : ""}${formatCurrency(delta)} ${t("summary.vsLastMonth")}`
              : t("summary.noPriorMonth")
          }
        />
      </div>

      <section className="space-y-2">
        <h2 className="mono-label">{t("attention.label")}</h2>

        {attention.length === 0 ? (
          <p className="flex items-center gap-2.5 border-l-2 border-[var(--semantic-success)] py-2 pl-3 text-sm text-[var(--color-muted-foreground)]">
            <CheckCircle2
              className="size-4 shrink-0 text-[var(--semantic-success-readable)]"
              aria-hidden
            />
            {t("summary.allClear")}
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-inner-border)] border border-[var(--color-inner-border)] bg-[var(--color-surface-solid)]">
            {attention.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onSelectProperty?.(row.id)}
                className="relative flex w-full items-center gap-3 py-3 pl-4 pr-4 text-left transition-colors hover:bg-[var(--color-hover)]"
              >
                {/* Scannable as a column: the eye finds the odd colour out without reading a
                    single label. */}
                <span
                  className={`absolute inset-y-0 left-0 w-0.5 ${SEVERITY_RULE[row.severity]}`}
                  aria-hidden
                />
                <row.Icon
                  className={`size-4 shrink-0 ${SEVERITY_TEXT[row.severity]}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-foreground)]">
                  {row.name}
                </span>
                <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                  {row.reason}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default PortfolioSummary;
