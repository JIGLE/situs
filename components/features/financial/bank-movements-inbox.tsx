"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RenderTable } from "@/components/ui/table";
import { useApp } from "@/lib/contexts/app-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import {
  INBOX_FILTERS,
  INBOX_FILTER_COUNT,
  INBOX_FILTER_QUERY,
  formatMovementAmount,
  isInboxFilter,
  type BankInboxSummary,
  type InboxFilter,
} from "@/lib/utils/bank-inbox";
import { bankStatusKey, matchSignals, type MatchSignal } from "@/lib/utils/bank-labels";
import { formatDate } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/utils";
import { BankSyncStrip } from "./bank-sync-strip";

/**
 * Situs Bank Movements inbox: the owner's to-do list for money that arrived. It opens on the
 * movements waiting for a decision. Auto-matches already created a draft receipt through the
 * allocation waterfall; the rest wait here to be confirmed, assigned or ignored, and money going
 * out waits apart, since none of it can be rent. Confidence and fired signals are always shown
 * (explainability).
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

type InboxAction = "confirm" | "reassign" | "ignore" | "restore";

const STATUS_STYLES: Record<string, string> = {
  auto_matched: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  matched_confirmed: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  needs_review: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  imported: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  ignored: "text-[var(--color-muted-foreground)]",
  duplicate: "text-[var(--color-muted-foreground)] line-through",
};

/** Each filter's label, under `financial.bank`. */
const FILTER_LABEL_KEY = {
  review: "needsReview",
  outgoing: "outgoing",
  auto: "autoMatched",
  confirmed: "confirmed",
  ignored: "ignored",
  all: "allMovements",
} as const satisfies Record<InboxFilter, string>;

interface Props {
  /** The inbox's counts. The Finance page owns them, so its tab can show one too. */
  summary?: BankInboxSummary | null;
  /** Called after anything that changes the counts: an action, or a sync. */
  onChanged?: () => void;
}

export function BankMovementsInbox({ summary = null, onChanged }: Props): React.ReactElement {
  const apiError = useApiError();
  const t = useTranslations("financial.bank");
  const tForms = useTranslations("forms");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const { state, refreshData } = useApp();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [filter, setFilter] = useState<InboxFilter>("review");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const leaseOptions = useMemo(
    () =>
      state.leases
        .filter((lease) => lease.status === "active")
        .map((lease) => {
          const tenant = state.tenants.find((t) => t.id === lease.tenantId);
          const property = state.properties.find((p) => p.id === lease.propertyId);
          return {
            id: lease.id,
            tenantName: tenant?.name ?? "—",
            label: `${tenant?.name ?? "—"} · ${property?.name ?? "—"}`,
          };
        }),
    [state.leases, state.tenants, state.properties],
  );

  /** `quiet` keeps the current rows on screen while they refresh, after an action or a sync. */
  const load = useCallback(
    async (target: InboxFilter, quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<InboxRow[]>(
          `/api/bank/transactions${INBOX_FILTER_QUERY[target]}`,
        );
        setRows(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(apiError(err));
        if (!quiet) setRows([]);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [apiError],
  );

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  /** What to tell the owner once an action has worked. */
  function doneMessage(row: InboxRow, action: InboxAction, leaseId?: string): string {
    if (action === "ignore") return t("toast.ignored");
    if (action === "restore") return t("toast.restored");
    const tenant =
      action === "reassign"
        ? (leaseOptions.find((lease) => lease.id === leaseId)?.tenantName ?? "—")
        : (row.suggestedLease?.tenantName ?? "—");
    return t("toast.confirmed", { tenant });
  }

  const act = async (row: InboxRow, action: InboxAction, leaseId?: string) => {
    setBusyId(row.id);
    setError(null);
    try {
      await apiFetch(`/api/bank/transactions/${row.id}`, csrfToken, "PUT", { action, leaseId });
      setReassigningId(null);
      toast.success(doneMessage(row, action, leaseId));
      // A confirmed movement is a new receipt and a paid month: the rest of the app reads those
      // from app state, which would otherwise show them only after a reload.
      if (action === "confirm" || action === "reassign") await refreshData();
      await load(filter, true);
      onChanged?.();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusyId(null);
    }
  };

  function describeSignal(signal: MatchSignal): string {
    switch (signal.key) {
      case "signals.rule":
        return t("signals.rule", signal.values);
      case "signals.referenceConflict":
        return t("signals.referenceConflict", signal.values);
      default:
        return t(signal.key);
    }
  }

  function statusLabel(status: string): string {
    const key = bankStatusKey(status);
    // A status no code writes any more shows its code, as the audit trail does, rather than
    // failing the whole list.
    return key ? t(key) : status;
  }

  function filterLabel(value: InboxFilter): string {
    const label = t(FILTER_LABEL_KEY[value]);
    return summary ? `${label} (${summary[INBOX_FILTER_COUNT[value]]})` : label;
  }

  /**
   * Match suggestion and row actions, shared by the table cell and the mobile card so the two
   * can never diverge. Both close over `reassigningId`/`busyId`, which is why they live here
   * rather than as module-level components.
   */
  const renderMatch = (row: InboxRow) => {
    const signals = matchSignals(row.matchReasons).map(describeSignal).join(" · ");
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
        {signals ? (
          <span className="block text-xs text-[var(--color-muted-foreground)]">{signals}</span>
        ) : null}
      </>
    );
  };

  const renderStatus = (row: InboxRow) => (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[row.status] ?? "",
      )}
    >
      {statusLabel(row.status)}
    </span>
  );

  const renderAmount = (row: InboxRow) => (
    <span
      className={cn(
        "font-mono tabular-nums",
        row.amount < 0 && "text-[var(--semantic-danger-readable)]",
      )}
    >
      {formatMovementAmount(row.amount, row.currency)}
    </span>
  );

  const renderActions = (row: InboxRow) => {
    if (row.status === "ignored" && !row.receiptId) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-none px-2 text-xs"
          onClick={() => void act(row, "restore")}
          disabled={busyId === row.id}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          {t("restore")}
        </Button>
      );
    }
    const actionable = row.status === "needs_review" || row.status === "imported";
    if (!actionable) return null;
    if (reassigningId === row.id) {
      return (
        <div className="flex items-center gap-1">
          <Select
            onValueChange={(leaseId) => void act(row, "reassign", leaseId)}
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
            onClick={() => void act(row, "confirm")}
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
          onClick={() => void act(row, "ignore")}
          disabled={busyId === row.id}
        >
          {t("ignore")}
        </Button>
      </div>
    );
  };

  const emptyMessage =
    filter === "all" ? t("empty") : filter === "review" ? t("emptyReview") : t("emptyFiltered");

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
      <BankSyncStrip
        onSynced={() => {
          void load(filter, true);
          onChanged?.();
        }}
      />

      {/* No heading: the tab label is this view's heading. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <Select value={filter} onValueChange={(value) => isInboxFilter(value) && setFilter(value)}>
          <SelectTrigger
            className="h-8 w-[220px] rounded-none text-xs"
            aria-label={t("filterStatus")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INBOX_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {filterLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p
          role="alert"
          className="border-b border-[var(--color-border)] px-4 py-2 text-sm text-[var(--semantic-danger-readable)]"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">{tCommon("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="p-6 text-sm text-[var(--color-muted-foreground)]">{emptyMessage}</p>
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
                    {row.bankAccount.label} · {formatDate(row.bookingDate, locale)}
                  </p>
                </div>
                <span className="shrink-0">{renderAmount(row)}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {renderStatus(row)}
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
              cell: (row) => formatDate(row.bookingDate, locale),
              cellClassName: "text-xs tabular-nums",
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
              cell: renderAmount,
              cellClassName: "text-right",
            },
            { key: "match", header: t("match"), cell: renderMatch },
            { key: "status", header: tForms("status"), cell: renderStatus },
            {
              key: "actions",
              header: <span className="sr-only">{t("actions")}</span>,
              cell: renderActions,
            },
          ]}
        />
      )}
    </div>
  );
}
