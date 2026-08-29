"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { httpError, useApiError } from "@/lib/utils/api-error";

import { Button } from "@/components/ui/button";
import { csrfHeaders } from "@/lib/utils/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Situs OCR surfaces for the Documents view — OCR Queue (every classification
 * the mock engine has run) and Review Required (the actionable subset: low
 * confidence or an unlinked entity). Inbox (unassigned uploads) is a plain
 * filter over `useDocuments`, handled by the caller; this component owns the
 * two surfaces that read DocumentExtraction.
 */

interface QueueRow {
  id: string;
  documentId: string;
  status: string;
  engine: string;
  confidence: number | null;
  suggestedType: string | null;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  createdAt: string;
  document: { name: string; mimeType: string; type: string };
}

const DOCUMENT_TYPE_OPTIONS = [
  "contract",
  "invoice",
  "receipt",
  "photo",
  "floor_plan",
  "certificate",
  "other",
] as const;

export function DocumentReviewQueue({ scope }: { scope: "queue" | "review" }): React.ReactElement {
  const apiError = useApiError();
  const t = useTranslations("common");
  const tActions = useTranslations("actions");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = scope === "review" ? "?status=review_required" : "";
      const res = await fetch(`/api/documents/ocr-queue${query}`, { credentials: "include" });
      if (!res.ok) throw httpError(res.status);
      const body = await res.json();
      setRows(body?.data ?? []);
    } catch (err) {
      setError(apiError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [scope, apiError]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = useCallback(
    async (documentId: string) => {
      setBusyId(documentId);
      setError(null);
      try {
        const res = await fetch(`/api/documents/${documentId}/extraction`, {
          method: "PUT",
          credentials: "include",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ accept: true }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Accept failed (${res.status})`);
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

  const correct = useCallback(
    async (documentId: string) => {
      const type = corrections[documentId];
      if (!type) return;
      setBusyId(documentId);
      setError(null);
      try {
        const res = await fetch(`/api/documents/${documentId}/extraction`, {
          method: "PUT",
          credentials: "include",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ accept: false, type }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Correction failed (${res.status})`);
        }
        await load();
      } catch (err) {
        setError(apiError(err));
      } finally {
        setBusyId(null);
      }
    },
    [corrections, load, apiError],
  );

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <p className="mono-label">
          {scope === "review"
            ? "Review required · needs a decision"
            : "OCR queue · every classification run"}
        </p>
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
          {scope === "review"
            ? "Nothing waiting on review."
            : "No documents have been classified yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-[13px]">
            <thead>
              <tr>
                {[
                  "Document",
                  "Engine",
                  "Suggested type",
                  "Confidence",
                  "Linked to",
                  "Status",
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
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--color-hover)]">
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                    <span className="block max-w-[220px] truncate font-medium">
                      {row.document.name}
                    </span>
                  </td>
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase text-[var(--color-muted-foreground)]">
                    {row.engine}
                  </td>
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5 capitalize">
                    {row.suggestedType?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5 font-mono tabular-nums">
                    {row.confidence !== null ? `${Math.round(row.confidence * 100)}%` : "—"}
                  </td>
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5 text-xs capitalize text-[var(--color-muted-foreground)]">
                    {row.linkedEntityType ?? "unassigned"}
                  </td>
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                    <span className="font-mono text-[12px] md:text-[10px] uppercase tracking-[0.04em] text-[var(--color-muted-foreground)]">
                      {row.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="border-b border-[var(--color-border)] px-3 py-2.5">
                    {row.status === "review_required" ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-none px-2 text-xs"
                          onClick={() => void accept(row.documentId)}
                          disabled={busyId === row.documentId}
                        >
                          {t("accept")}
                        </Button>
                        <Select
                          onValueChange={(value) =>
                            setCorrections((prev) => ({ ...prev, [row.documentId]: value }))
                          }
                        >
                          <SelectTrigger className="h-7 w-[120px] rounded-none text-xs">
                            <SelectValue placeholder={t("correct")} />
                          </SelectTrigger>
                          <SelectContent>
                            {DOCUMENT_TYPE_OPTIONS.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t.replace(/_/g, " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {corrections[row.documentId] ? (
                          <Button
                            size="sm"
                            className="h-7 rounded-none px-2 text-xs"
                            onClick={() => void correct(row.documentId)}
                            disabled={busyId === row.documentId}
                          >
                            {tActions("save")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
