"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { httpError, useApiError } from "@/lib/utils/api-error";

import { Button } from "@/components/ui/button";
import { csrfHeaders } from "@/lib/utils/api-client";

/**
 * Situs ReceiptAutomationQueue — the receipts still moving through the
 * document lifecycle. Automation-sourced drafts (from a bank match) and
 * anything not yet emitted land here for a one-click "Emit" (which archives
 * the PDF) or "Void". Manual receipt CRUD stays in the table below —
 * this panel is additive, not a replacement.
 */

interface QueueRow {
  id: string;
  amount: number;
  date: string;
  referenceMonth: string | null;
  lifecycle: string;
  source: string;
  tenantName: string;
  propertyName: string;
  matchConfidence: number | null;
  taxFiling: { id: string; status: string } | null;
}

const LIFECYCLE_STYLES: Record<string, string> = {
  draft: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  review: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  rejected: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  submitted: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  accepted: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  emitted: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  exported: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  voided: "text-[var(--color-muted-foreground)] line-through",
};

export function ReceiptAutomationQueue(): React.ReactElement | null {
  const apiError = useApiError();
  const t = useTranslations("common");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/receipt-queue", { credentials: "include" });
      if (!res.ok) throw httpError(res.status);
      const body = await res.json();
      setRows(body?.data ?? []);
      setSelected(new Set());
    } catch (err) {
      setError(apiError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiError]);

  useEffect(() => {
    void load();
  }, [load]);

  const emit = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/receipts/${id}/lifecycle`, {
          method: "PUT",
          credentials: "include",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ to: "emitted" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Emit failed (${res.status})`);
        }
        await load();
      } catch (err) {
        setError(apiError(err));
      } finally {
        setBusyId(null);
      }
    },
    [load, apiError],
  );

  const bulkEmit = useCallback(async () => {
    setBulkBusy(true);
    setError(null);
    const ids = [...selected];
    const failures: string[] = [];
    for (const id of ids) {
      const res = await fetch(`/api/receipts/${id}/lifecycle`, {
        method: "PUT",
        credentials: "include",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ to: "emitted" }),
      }).catch(() => null);
      if (!res || !res.ok) failures.push(id);
    }
    if (failures.length > 0) {
      setError(`${failures.length} of ${ids.length} receipts could not be emitted`);
    }
    setBulkBusy(false);
    await load();
  }, [selected, load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const emittable = rows.filter((r) => r.lifecycle === "draft" || r.lifecycle === "review");

  if (!loading && rows.length === 0 && !error) return null;

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <p className="mono-label">Receipt automation queue · needs action</p>
        {selected.size > 0 ? (
          <Button
            size="sm"
            className="h-8 rounded-none"
            onClick={() => void bulkEmit()}
            disabled={bulkBusy}
          >
            {bulkBusy ? "Emitting…" : `Emit ${selected.size} selected`}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="border-b border-[var(--color-border)] px-4 py-2 text-sm text-[var(--semantic-danger-readable)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="w-8 border-b border-[var(--color-border)] px-3 py-2" />
                {[
                  "Payment",
                  "Contract",
                  "Reference month",
                  "Match",
                  "Receipt status",
                  "Tax status",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="mono-label border-b border-[var(--color-border)] px-3 py-2 text-left font-normal"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canEmit = row.lifecycle === "draft" || row.lifecycle === "review";
                return (
                  <tr key={row.id} className="hover:bg-[var(--color-hover)]">
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                      {canEmit ? (
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select receipt for ${row.tenantName}`}
                        />
                      ) : null}
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5 font-mono tabular-nums">
                      €{row.amount.toFixed(2)}
                      <span className="block text-xs text-[var(--color-muted-foreground)]">
                        {row.date.slice(0, 10)} · {row.source}
                      </span>
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                      <span className="block truncate font-medium">{row.tenantName}</span>
                      <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                        {row.propertyName}
                      </span>
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5 font-mono text-xs tabular-nums">
                      {row.referenceMonth ?? "—"}
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5 font-mono text-xs tabular-nums">
                      {row.matchConfidence !== null
                        ? `${Math.round(row.matchConfidence * 100)}%`
                        : "—"}
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                      <span
                        className={`inline-block px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] uppercase tracking-[0.04em] ${
                          LIFECYCLE_STYLES[row.lifecycle] ?? ""
                        }`}
                      >
                        {row.lifecycle}
                      </span>
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5 text-xs text-[var(--color-muted-foreground)]">
                      {row.taxFiling ? row.taxFiling.status : "—"}
                    </td>
                    <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                      {canEmit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-none px-2 text-xs"
                          onClick={() => void emit(row.id)}
                          disabled={busyId === row.id}
                        >
                          {t("emit")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {emittable.length === 0 && rows.length > 0 && !loading ? (
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted-foreground)]">
          Nothing waiting on emission — the rows above are already submitted, accepted, or archived.
        </p>
      ) : null}
    </div>
  );
}
