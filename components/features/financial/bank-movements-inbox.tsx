"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { httpError, useApiError } from "@/lib/utils/api-error";
import { Check, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/contexts/app-context";
import { csrfHeaders } from "@/lib/utils/api-client";
import { RenderTable } from "@/components/ui/table";

/**
 * Situs Bank Movements inbox — every imported movement with its match
 * explanation. Auto-matches already created a draft receipt through the
 * allocation waterfall; everything else waits here for confirm / reassign /
 * ignore. Confidence and fired signals are always shown (explainability).
 */

interface InboxRow {
  id: string;
  amount: number;
  currency: string;
  bookingDate: string;
  valueDate: string | null;
  counterpartyName: string | null;
  reference: string | null;
  status: string;
  suggestedLeaseId: string | null;
  matchConfidence: number | null;
  matchReasons: string | null;
  duplicateOfId: string | null;
  receiptId: string | null;
  bankAccount: { label: string };
  suggestedLease: { tenantName: string; propertyName: string } | null;
}

interface ImportSummary {
  imported: number;
  duplicates: number;
  autoMatched: number;
  needsReview: number;
  errors: string[];
  parseErrors: string[];
}

const STATUS_STYLES: Record<string, string> = {
  auto_matched: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  matched_confirmed: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  needs_review: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  imported: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  ignored: "text-[var(--color-muted-foreground)]",
  duplicate: "text-[var(--color-muted-foreground)] line-through",
};

const STATUS_CODES: Record<string, string> = {
  auto_matched: "AUTO",
  matched_confirmed: "CONF",
  needs_review: "REVIEW",
  imported: "NEW",
  ignored: "IGN",
  duplicate: "DUP",
};

/** Filter ids paired with their catalog key — the label resolves inside the component,
 *  since a module constant can never be translated. */
const FILTERS = [
  { value: "all", labelKey: "allMovements" },
  { value: "needs_review", labelKey: "needsReview" },
  { value: "auto_matched", labelKey: "autoMatched" },
  { value: "matched_confirmed", labelKey: "confirmed" },
  { value: "ignored", labelKey: "ignored" },
] as const;

const CSV_PLACEHOLDER = `Date,Amount,Counterparty,IBAN,Reference
2026-07-01,850.00,Maria Silva,PT50...,renda 07/2026`;

function formatReasons(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { reasons?: string[]; warnings?: string[]; rule?: string };
    const parts = [...(parsed.reasons ?? []), ...(parsed.warnings ?? [])];
    return parts.join(" · ").replace(/_/g, " ");
  } catch {
    return "";
  }
}

export function BankMovementsInbox(): React.ReactElement {
  const apiError = useApiError();
  const t = useTranslations("financial.bank");
  const tForms = useTranslations("forms");
  const { state } = useApp();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  const leaseOptions = useMemo(
    () =>
      state.leases
        .filter((lease) => lease.status === "active")
        .map((lease) => {
          const tenant = state.tenants.find((t) => t.id === lease.tenantId);
          const property = state.properties.find((p) => p.id === lease.propertyId);
          return {
            id: lease.id,
            label: `${tenant?.name ?? "Tenant"} — ${property?.name ?? "Property"}`,
          };
        }),
    [state.leases, state.tenants, state.properties],
  );

  const load = useCallback(
    async (statusFilter: string) => {
      setLoading(true);
      setError(null);
      try {
        const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
        const res = await fetch(`/api/bank/transactions${query}`, { credentials: "include" });
        if (!res.ok) throw httpError(res.status);
        const body = await res.json();
        setRows(body?.data ?? []);
      } catch (err) {
        setError(apiError(err));
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [apiError],
  );

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const act = useCallback(
    async (id: string, action: "confirm" | "reassign" | "ignore", leaseId?: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/bank/transactions/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ action, leaseId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Action failed (${res.status})`);
        }
        setReassigningId(null);
        await load(filter);
      } catch (err) {
        setError(apiError(err));
      } finally {
        setBusyId(null);
      }
    },
    [filter, load, apiError],
  );

  const runImport = useCallback(async () => {
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const res = await fetch("/api/bank/import", {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ csv: csvText }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Import failed (${res.status})`);
      setImportResult(body?.data ?? null);
      setCsvText("");
      await load(filter);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setImporting(false);
    }
  }, [csvText, filter, load, apiError]);

  /**
   * Match suggestion and row actions, shared by the table cell and the mobile card so the two
   * can never diverge. Both close over `reassigningId`/`busyId`, which is why they live here
   * rather than as module-level components.
   */
  const renderMatch = (row: InboxRow) => {
    const reasons = formatReasons(row.matchReasons);
    return (
      <>
        {row.suggestedLease ? (
          <span className="block text-xs">
            {row.suggestedLease.tenantName}
            <span className="text-[var(--color-muted-foreground)]">
              {" "}
              · {row.suggestedLease.propertyName}
            </span>
            {row.matchConfidence !== null ? (
              <span className="ml-1 font-mono tabular-nums">
                {Math.round(row.matchConfidence * 100)}%
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-muted-foreground)]">{t("noSuggestion")}</span>
        )}
        {reasons ? (
          <span className="block text-[12px] md:text-[10px] text-[var(--color-muted-foreground)]">
            {reasons}
          </span>
        ) : null}
      </>
    );
  };

  const renderActions = (row: InboxRow) => {
    const actionable = row.status === "needs_review" || row.status === "imported";
    if (!actionable) return null;
    if (reassigningId === row.id) {
      return (
        <div className="flex items-center gap-1">
          <Select
            onValueChange={(leaseId) => void act(row.id, "reassign", leaseId)}
            disabled={busyId === row.id}
          >
            <SelectTrigger
              className="h-7 w-[190px] rounded-none text-xs"
              aria-label={t("assignToLease")}
            >
              <SelectValue placeholder={t("assignToLease")} />
            </SelectTrigger>
            <SelectContent>
              {leaseOptions.map((lease) => (
                <SelectItem key={lease.id} value={lease.id}>
                  {lease.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-none p-0"
            onClick={() => setReassigningId(null)}
            aria-label={t("cancelReassign")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1">
        {row.suggestedLeaseId && row.amount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-none px-2 text-xs"
            onClick={() => void act(row.id, "confirm")}
            disabled={busyId === row.id}
          >
            <Check className="mr-1 h-3 w-3" />
            {t("confirm")}
          </Button>
        ) : null}
        {row.amount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-none px-2 text-xs"
            onClick={() => setReassigningId(row.id)}
            disabled={busyId === row.id}
          >
            {t("assign")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-none px-2 text-xs text-[var(--color-muted-foreground)]"
          onClick={() => void act(row.id, "ignore")}
          disabled={busyId === row.id}
        >
          {t("ignore")}
        </Button>
      </div>
    );
  };

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <p className="mono-label">Bank movements · matching inbox</p>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger
              className="h-8 w-[170px] rounded-none text-xs"
              aria-label={t("filterStatus")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {t(f.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog
            open={importOpen}
            onOpenChange={(open) => {
              setImportOpen(open);
              if (!open) setImportResult(null);
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 rounded-none">
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {t("importCsv")}
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-none sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>{t("importTitle")}</DialogTitle>
                <DialogDescription>
                  Paste CSV rows exported from your bank. Recognized columns: date, amount,
                  counterparty, IBAN, reference — comma or semicolon separated. Exact duplicates are
                  skipped automatically.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={CSV_PLACEHOLDER}
                rows={8}
                className="rounded-none font-mono text-xs"
              />
              {importResult ? (
                <div className="border border-[var(--color-border)] px-3 py-2 text-xs">
                  <span className="font-medium">
                    {importResult.imported} imported · {importResult.autoMatched} auto-matched ·{" "}
                    {importResult.needsReview} to review · {importResult.duplicates} duplicates
                    skipped
                  </span>
                  {[...importResult.parseErrors, ...importResult.errors].map((msg, i) => (
                    <span key={i} className="block text-[var(--semantic-warning-readable)]">
                      {msg}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="rounded-none"
                  onClick={() => void runImport()}
                  disabled={importing || csvText.trim().length === 0}
                >
                  {importing ? "Importing…" : "Import"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error ? (
        <p className="border-b border-[var(--color-border)] px-4 py-2 text-sm text-[var(--semantic-danger-readable)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
          No bank movements{filter !== "all" ? " with this status" : ""}. Import a CSV from your
          bank to start matching payments to reference months.
        </p>
      ) : (
        <RenderTable
          data={rows}
          rowKey={(row) => row.id}
          cardMode
          renderCard={(row) => (
            <div className="border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.counterpartyName ?? "—"}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {row.bankAccount.label} · {row.bookingDate.slice(0, 10)}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono tabular-nums ${
                    row.amount < 0 ? "text-[var(--semantic-danger-readable)]" : ""
                  }`}
                >
                  {row.amount.toFixed(2)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-block px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] uppercase tracking-[0.04em] ${
                    STATUS_STYLES[row.status] ?? ""
                  }`}
                >
                  {STATUS_CODES[row.status] ?? row.status}
                </span>
                {row.reference ? (
                  <span className="min-w-0 truncate text-xs text-[var(--color-muted-foreground)]">
                    {row.reference}
                  </span>
                ) : null}
              </div>

              <div className="mt-2">{renderMatch(row)}</div>
              <div className="mt-2">{renderActions(row)}</div>
            </div>
          )}
          columns={[
            {
              key: "booked",
              header: t("booked"),
              cell: (row) => row.bookingDate.slice(0, 10),
              cellClassName: "font-mono text-xs tabular-nums",
            },
            {
              key: "counterparty",
              header: t("counterparty"),
              cell: (row) => (
                <>
                  <span className="block max-w-[180px] truncate font-medium">
                    {row.counterpartyName ?? "—"}
                  </span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    {row.bankAccount.label}
                  </span>
                </>
              ),
            },
            {
              key: "reference",
              header: t("reference"),
              cell: (row) => (
                <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                  {row.reference ?? "—"}
                </span>
              ),
              cellClassName: "max-w-[200px]",
            },
            {
              key: "amount",
              header: t("amount"),
              headerClassName: "text-right",
              // The code, not a localised symbol: this column is deliberately the bank's own
              // figures in mono, so it stays sortable and matches the statement being
              // reconciled against. But it dropped the currency entirely, and `currency` is a
              // per-movement field precisely because it varies — a movement on a non-EUR
              // account rendered as a bare "850.00" under a header that only says "Amount".
              cell: (row) => (
                <>
                  {row.amount.toFixed(2)}{" "}
                  <span className="text-[var(--color-muted-foreground)]">{row.currency}</span>
                </>
              ),
              cellClassName: "text-right font-mono tabular-nums",
            },
            { key: "match", header: t("match"), cell: renderMatch },
            {
              key: "status",
              header: tForms("status"),
              cell: (row) => (
                <span
                  className={`inline-block px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] uppercase tracking-[0.04em] ${
                    STATUS_STYLES[row.status] ?? ""
                  }`}
                >
                  {STATUS_CODES[row.status] ?? row.status}
                </span>
              ),
            },
            { key: "actions", header: "", cell: renderActions },
          ]}
        />
      )}
    </div>
  );
}
