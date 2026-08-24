"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, FileCheck2, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RenderTable } from "@/components/ui/table";
import { useCurrency } from "@/lib/contexts/currency-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TaxFilingWizard, type TaxFilingProperty } from "./tax-filing-wizard";
import { useToast } from "@/lib/contexts/toast-context";
import { useApp } from "@/lib/app-context-db";
import { csrfHeaders } from "@/lib/utils/api-client";

// ── types ──────────────────────────────────────────────────────────────────

interface TaxFilingRecord {
  id: string;
  year: number;
  country: string;
  regime: string;
  taxDue: number;
  balanceDue: number;
  status: string;
  createdAt: string;
}

// The two helpers that used to live here are gone.
//
// `formatCurrency` was `Intl.NumberFormat("pt-PT", … "EUR")` — hardcoded, so a Spanish owner read
// Portuguese formatting on a fiscal screen while every other view in the app went through
// `useCurrency()`. `countryFlag` returned 🇵🇹/🇪🇸, the only place in Situs that used emoji as
// data; the jurisdiction is a code, and `.mono-label` is the documented system voice for codes.

// ── shared bits ────────────────────────────────────────────────────────────

/** One figure in the year-to-date band. Same shape as `portfolio-summary.tsx`'s stat row, so the
 *  two summaries in the app read as one system rather than two takes on the same idea. */
function PositionFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-[var(--color-inner-border)] px-4 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <div className="mono-label">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums tracking-tight text-[var(--color-foreground)]">
        {value}
      </div>
    </div>
  );
}

/** Draft vs final, in one place — the table cell and the mobile card would otherwise drift. */
function StatusBadge({ filing, t }: { filing: TaxFilingRecord; t: (key: string) => string }) {
  return (
    <Badge variant={filing.status === "final" ? "default" : "secondary"} className="text-xs">
      {filing.status === "final" ? t("statusFinal") : t("statusDraft")}
    </Badge>
  );
}

// ── view ───────────────────────────────────────────────────────────────────

export function TaxFilingView() {
  const t = useTranslations("taxFiling");
  const tForms = useTranslations("forms");
  const toast = useToast();
  const { state } = useApp();
  const { formatCurrency } = useCurrency();

  const [filings, setFilings] = useState<TaxFilingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaxFilingRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [position, setPosition] = useState<{
    grossIncome: number;
    deductibleExpenses: number;
  } | null>(null);

  const fetchFilings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tax-filings");
      if (res.ok) {
        const json = await res.json();
        setFilings(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFilings();
  }, [fetchFilings]);

  /**
   * Where this year stands, from the same endpoint the wizard uses to fill its income step.
   *
   * Deliberately income and expenses only. Tax due needs a regime, and the regime is a choice the
   * owner makes in the wizard — guessing one to put a confident number on a compliance screen
   * would be worse than the blank space this replaces.
   */
  const propertyIds = (state.properties ?? []).map((p) => p.id).join(",");
  useEffect(() => {
    // The endpoint 400s on an empty `propertyIds`, and a band of zeroes says less than no band.
    if (!propertyIds) return;
    let cancelled = false;
    const year = new Date().getFullYear();
    void fetch(`/api/tax-filings/income-summary?propertyIds=${propertyIds}&year=${year}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) setPosition(json.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [propertyIds]);

  const handleSaved = () => {
    setShowWizard(false);
    void fetchFilings();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tax-filings/${deleteTarget.id}`, {
        method: "DELETE",
        headers: csrfHeaders(),
      });
      if (res.ok) {
        toast.success(t("filingDeleted"));
        setDeleteTarget(null);
        void fetchFilings();
      } else {
        toast.error(t("calcError"));
      }
    } finally {
      setDeleting(false);
    }
  };

  // Map app-context properties to wizard shape
  const wizardProperties: TaxFilingProperty[] = (state.properties ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    country: p.country,
  }));

  return (
    <div className="space-y-6 p-6">
      {/* Header. `flex-wrap` and a gap because without them the action overlapped the subtitle
          at 390px — the row had no way to break. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{t("subtitle")}</p>
        </div>
        <Button
          onClick={() => setShowWizard(true)}
          className="gap-2 bg-accent-primary hover:bg-accent-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("newFiling")}
        </Button>
      </div>

      {/* Where this year stands. Facts, not a projection — see the effect above. */}
      {position && (
        <section className="space-y-2">
          <h2 className="mono-label">{t("positionHeading", { year: new Date().getFullYear() })}</h2>
          {/* Grid, not `flex-1` in a row. Three equal cells across a 390px phone gave each about
              110px and the figures overlapped — a defect the audit cannot see, because text
              spilling inside its own container changes no scroll width. Doctrine rule 6: multi
              column becomes single column below `md`. */}
          <div className="grid grid-cols-1 border border-[var(--color-inner-border)] bg-[var(--color-surface-solid)] sm:grid-cols-3">
            <PositionFigure label={t("grossIncome")} value={formatCurrency(position.grossIncome)} />
            <PositionFigure
              label={t("deductibleExpenses")}
              value={formatCurrency(position.deductibleExpenses)}
            />
            <PositionFigure
              label={t("netPosition")}
              value={formatCurrency(position.grossIncome - position.deductibleExpenses)}
            />
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">{t("positionNote")}</p>
        </section>
      )}

      {/* Filing list. `RenderTable` rather than a stack of cards, which is what every other
          record list in the app uses (leases, tenants, rent roll, bank movements) and what
          carries the doctrine's card fallback below `md`. As cards, each row put its identity
          at the far left and its figures at the far right with a void between them at 1440px. */}
      {loading ? (
        <div className="text-sm text-[var(--color-muted-foreground)]">{t("loadingIncome")}</div>
      ) : (
        <RenderTable
          data={filings}
          rowKey={(filing) => filing.id}
          cardMode
          renderCard={(filing) => (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--color-foreground)]">
                    <span className="mono-label mr-2">{filing.country}</span>
                    {filing.year}
                  </span>
                  <StatusBadge filing={filing} t={t} />
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">{filing.regime}</p>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-[var(--color-muted-foreground)]">{t("taxDueLabel")}</span>
                  <span className="font-semibold tabular-nums text-[var(--color-foreground)]">
                    {formatCurrency(filing.taxDue)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-[var(--color-muted-foreground)]">
                    {t("balanceDueLabel")}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${filing.balanceDue > 0 ? "text-destructive" : "text-[var(--color-success)]"}`}
                  >
                    {formatCurrency(filing.balanceDue)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(filing)}
                  className="w-full"
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("delete")}
                </Button>
              </CardContent>
            </Card>
          )}
          emptyState={
            <Card>
              <CardContent className="space-y-2 p-12 text-center">
                <FileCheck2 className="mx-auto h-10 w-10 text-[var(--color-muted-foreground)]" />
                <p className="font-medium text-[var(--color-foreground)]">{t("noFilings")}</p>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {t("noFilingsDescription")}
                </p>
              </CardContent>
            </Card>
          }
          columns={[
            {
              key: "year",
              header: t("year"),
              cell: (filing) => (
                <span className="flex items-center gap-2 font-medium text-[var(--color-foreground)]">
                  {filing.status === "final" ? (
                    <FileCheck2 className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
                  ) : (
                    <FileEdit
                      className="h-4 w-4 text-[var(--color-muted-foreground)]"
                      aria-hidden
                    />
                  )}
                  {filing.year}
                </span>
              ),
            },
            {
              key: "country",
              header: t("country"),
              // The jurisdiction is a code, and `.mono-label` is the design system's voice for
              // codes. It replaces an emoji flag — the only place in the app that used one.
              cell: (filing) => <span className="mono-label">{filing.country}</span>,
            },
            {
              key: "regime",
              header: t("regime"),
              cell: (filing) => (
                <span className="text-[var(--color-muted-foreground)]">{filing.regime}</span>
              ),
            },
            {
              key: "status",
              // `forms.status`, not `taxFiling.statusDraft`. A column header names the field, and
              // the first draft of this used one of the field's own VALUES — so the column of
              // Draft/Final badges sat under a heading that said "Draft".
              header: tForms("status"),
              cell: (filing) => <StatusBadge filing={filing} t={t} />,
            },
            {
              key: "taxDue",
              header: t("taxDueLabel"),
              headerClassName: "text-right",
              cellClassName: "text-right",
              cell: (filing) => (
                <span className="font-semibold tabular-nums text-[var(--color-foreground)]">
                  {formatCurrency(filing.taxDue)}
                </span>
              ),
            },
            {
              key: "balanceDue",
              header: t("balanceDueLabel"),
              headerClassName: "text-right",
              cellClassName: "text-right",
              cell: (filing) => (
                <span
                  className={`font-semibold tabular-nums ${filing.balanceDue > 0 ? "text-destructive" : "text-[var(--color-success)]"}`}
                >
                  {formatCurrency(filing.balanceDue)}
                </span>
              ),
            },
            {
              key: "created",
              header: t("createdAt"),
              cell: (filing) => (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {new Date(filing.createdAt).toLocaleDateString()}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              cellClassName: "text-right",
              cell: (filing) => (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteTarget(filing)}
                  className="text-[var(--color-muted-foreground)] hover:text-destructive"
                  // Was the hardcoded English string "Delete filing".
                  aria-label={t("deleteFilingLabel", { year: filing.year })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ),
            },
          ]}
        />
      )}

      {/* Wizard dialog */}
      <Dialog open={showWizard} onOpenChange={(open) => !open && setShowWizard(false)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[var(--color-foreground)]">{t("title")}</DialogTitle>
            <DialogDescription className="text-[var(--color-muted-foreground)]">
              {t("subtitle")}
            </DialogDescription>
          </DialogHeader>
          <TaxFilingWizard
            properties={wizardProperties}
            onSaved={handleSaved}
            onCancel={() => setShowWizard(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[var(--color-foreground)]">
              {t("deleteConfirm")}
            </DialogTitle>
            <DialogDescription className="text-[var(--color-muted-foreground)]">
              {t("deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
