"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, FileUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import type { ParsedRentReceipt } from "@/lib/services/financas-import/rent-receipt";
import type { ReceiptUploadOutcome } from "@/lib/services/receipts/financas-receipts";
import { useApiError } from "@/lib/utils/api-error";
import { MAX_CONTRACT_BYTES } from "@/lib/utils/contract-file";
import { formatEuro } from "@/lib/utils/currency";
import { formatMonthYear } from "@/lib/utils/format-date";
import { failureStatus, readRentReceipt, registerRentReceipt } from "./read-document";

type Failure = "notPdf" | "tooLarge" | "noText" | "notReceipt" | "failed";

interface Row {
  key: string;
  file: File;
  receipt: ParsedRentReceipt;
  leaseId: string;
  /** "YYYY-MM". */
  month: string;
  /** What the server said uploading it would do, for the contract and month it proposed. */
  proposed: { leaseId: string; month: string; outcome: ReceiptUploadOutcome } | null;
  /** The month's rent, when it differs from the recibo's. */
  dueAmount: number | null;
  /** Several contracts may be the one: the owner is asked to check. */
  ambiguous: boolean;
  done?: ReceiptUploadOutcome;
  error?: string;
}

/** What opening the sheet from a month in the matrix fills in when the recibo does not say. */
export interface ReceiptUploadPreset {
  leaseId: string;
  year: number;
  month: number;
}

export interface ReceiptUploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: ReceiptUploadPreset;
  /** Called once recibos are on the ledger, so the matrix reads it again. */
  onRegistered: () => void;
}

const monthValue = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * **Carregar recibos**: recibos de renda downloaded from the Portal das Finanças, one or many. Each
 * is read for the tenant's NIF, the month and the amount, matched to its contract, and listed with
 * what registering it will do: mark the month paid, add the recibo to a payment already there, or
 * nothing because it is already on file. The owner can change the contract or the month before
 * registering; the server reads each PDF again for its figures.
 */
export function ReceiptUploadSheet({
  open,
  onOpenChange,
  preset,
  onRegistered,
}: ReceiptUploadSheetProps) {
  const t = useTranslations("financasImport.receipts");
  const tFailure = useTranslations("financasImport.failure");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const apiError = useApiError();
  const { success } = useToast();
  const { state } = useApp();

  const [rows, setRows] = useState<Row[]>([]);
  const [failures, setFailures] = useState<{ file: string; reason: Failure }[]>([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setFailures([]);
  }, [open]);

  const leaseOptions = useMemo(
    () =>
      state.leases
        .filter((lease) => lease.status !== "draft")
        .map((lease) => {
          const tenant = state.tenants.find((x) => x.id === lease.tenantId);
          const property = state.properties.find((x) => x.id === lease.propertyId);
          return {
            id: lease.id,
            active: lease.status === "active",
            label: `${tenant?.name ?? lease.tenantName ?? "—"} · ${property?.name ?? lease.propertyName ?? "—"}`,
          };
        })
        .sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label)),
    [state.leases, state.tenants, state.properties],
  );
  const leaseLabel = (id: string) => leaseOptions.find((o) => o.id === id)?.label ?? "";

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setReading(true);
    const added: Row[] = [];
    const failed: { file: string; reason: Failure }[] = [];
    for (const file of files) {
      if (file.size > MAX_CONTRACT_BYTES) {
        failed.push({ file: file.name, reason: "tooLarge" });
        continue;
      }
      try {
        const { receipt, proposal } = await readRentReceipt(file);
        if (!receipt.recognised) {
          failed.push({ file: file.name, reason: "notReceipt" });
          continue;
        }
        const leaseId =
          proposal.leaseId ??
          proposal.candidates[0]?.leaseId ??
          (preset && proposal.candidates.length === 0 ? preset.leaseId : "");
        const month = proposal.month
          ? monthValue(proposal.month.year, proposal.month.month)
          : preset
            ? monthValue(preset.year, preset.month)
            : "";
        added.push({
          key: `${file.name}:${file.size}:${file.lastModified}`,
          file,
          receipt,
          leaseId,
          month,
          proposed:
            proposal.leaseId && proposal.month && proposal.outcome
              ? { leaseId: proposal.leaseId, month, outcome: proposal.outcome }
              : null,
          dueAmount: proposal.dueAmount,
          ambiguous: proposal.candidates.length > 1,
        });
      } catch (err) {
        const status = failureStatus(err);
        failed.push({
          file: file.name,
          reason: status === 415 ? "notPdf" : status === 422 ? "noText" : "failed",
        });
      }
    }
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.key));
      return [...prev, ...added.filter((r) => !seen.has(r.key))];
    });
    setFailures((prev) => [...prev, ...failed]);
    setReading(false);
  };

  const change = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  /** The outcome the server proposed, while the row still names that contract and month. */
  const outcomeOf = (row: Row): ReceiptUploadOutcome | null =>
    row.proposed && row.proposed.leaseId === row.leaseId && row.proposed.month === row.month
      ? row.proposed.outcome
      : null;

  const ready = rows.filter((row) => {
    const outcome = outcomeOf(row);
    return (
      !row.done &&
      row.leaseId &&
      /^\d{4}-\d{2}$/.test(row.month) &&
      outcome !== "duplicate" &&
      outcome !== "paid" &&
      outcome !== "no_month"
    );
  });

  const handleRegister = async () => {
    setSaving(true);
    let registered = 0;
    for (const row of ready) {
      try {
        const result = await registerRentReceipt(row.file, row.leaseId, row.month);
        change(row.key, { done: result.outcome, error: undefined });
        if (result.outcome === "create" || result.outcome === "attach") registered += 1;
      } catch (err) {
        change(row.key, { error: apiError(err) });
      }
    }
    setSaving(false);
    if (registered > 0) {
      success(t("registered", { count: registered }));
      onRegistered();
    }
  };

  const monthLabel = (value: string) => {
    const [year, month] = value.split("-").map(Number);
    return year && month ? formatMonthYear(year, month, locale) : value;
  };

  const describe = (row: Row): { text: string; tone: "plain" | "warn" | "done" } | null => {
    if (row.done === "duplicate") return { text: t("outcome.duplicate"), tone: "done" };
    if (row.done === "paid") {
      return { text: t("outcome.paid", { month: monthLabel(row.month) }), tone: "done" };
    }
    if (row.done) return { text: t("done", { month: monthLabel(row.month) }), tone: "done" };
    if (!row.leaseId) return { text: t("pickContract"), tone: "warn" };
    if (!row.month) return { text: t("pickMonth"), tone: "warn" };
    const outcome = outcomeOf(row);
    const month = monthLabel(row.month);
    if (outcome === "create") return { text: t("outcome.create", { month }), tone: "plain" };
    if (outcome === "attach") return { text: t("outcome.attach", { month }), tone: "plain" };
    if (outcome === "duplicate") return { text: t("outcome.duplicate"), tone: "done" };
    if (outcome === "paid") return { text: t("outcome.paid", { month }), tone: "done" };
    if (outcome === "no_month") return { text: t("outcome.noMonth", { month }), tone: "warn" };
    return { text: t("outcome.chosen", { month }), tone: "plain" };
  };

  // A recibo already on file, or for a month already paid, leaves nothing to do.
  const settled = (row: Row) => {
    const outcome = outcomeOf(row);
    return Boolean(row.done) || outcome === "duplicate" || outcome === "paid";
  };
  const pending = rows.some((row) => !settled(row));
  const allDone = rows.length > 0 && !pending;

  return (
    <Sheet open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <SheetContent side="center" className="md:max-w-2xl">
        <SheetHeader className="pr-14">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {rows.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">{t("where")}</p>
          )}
          <Input
            id="financas-recibos"
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={handleFiles}
            className="hidden"
            disabled={reading || saving}
          />
          <Label
            htmlFor="financas-recibos"
            className="flex min-h-11 cursor-pointer items-center justify-center gap-2 border border-dashed border-[var(--color-border)] bg-[var(--color-secondary)] px-4 py-3 text-sm transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            <FileUp className="h-4 w-4 shrink-0" />
            {reading ? t("reading") : rows.length > 0 ? t("addMore") : t("choose")}
          </Label>

          {failures.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive" aria-live="polite">
              {failures.map((f, i) => (
                <li key={`${f.file}-${i}`}>
                  <span className="font-medium">{f.file}</span>:{" "}
                  {f.reason === "notReceipt" ? t("notReceipt") : tFailure(f.reason)}
                </li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {rows.map((row) => {
                const said = describe(row);
                const amount = row.receipt.rent ?? row.receipt.received;
                return (
                  <li key={row.key} className="space-y-2 py-3">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">
                        {row.receipt.number
                          ? t("number", { number: row.receipt.number })
                          : row.file.name}
                      </span>
                      {amount !== null && (
                        <span className="shrink-0 tabular-nums">{formatEuro(amount)}</span>
                      )}
                    </div>
                    {row.done ? (
                      <p className="text-sm">{leaseLabel(row.leaseId)}</p>
                    ) : (
                      <div className="flex flex-col gap-2 md:flex-row">
                        <Select
                          value={row.leaseId}
                          onValueChange={(leaseId) => change(row.key, { leaseId })}
                          disabled={saving}
                        >
                          <SelectTrigger aria-label={t("contract")} className="md:flex-1">
                            <SelectValue placeholder={t("pickContract")} />
                          </SelectTrigger>
                          <SelectContent>
                            {leaseOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="month"
                          aria-label={t("month")}
                          value={row.month}
                          onChange={(e) => change(row.key, { month: e.target.value })}
                          disabled={saving}
                          className="md:w-44"
                        />
                      </div>
                    )}
                    {said && (
                      <p
                        className={
                          said.tone === "warn"
                            ? "text-xs text-[var(--semantic-warning-readable)]"
                            : said.tone === "done"
                              ? "flex items-center gap-1 text-xs text-[var(--semantic-success-readable)]"
                              : "text-xs text-[var(--color-muted-foreground)]"
                        }
                      >
                        {said.tone === "done" && (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        {said.text}
                      </p>
                    )}
                    {!row.done && row.ambiguous && (
                      <p className="text-xs text-[var(--semantic-warning-readable)]">
                        {t("ambiguous")}
                      </p>
                    )}
                    {!row.done && row.dueAmount !== null && amount !== null && (
                      <p className="text-xs text-[var(--semantic-warning-readable)]">
                        {t("amountDiffers", { due: formatEuro(row.dueAmount) })}
                      </p>
                    )}
                    {row.error && <p className="text-xs text-destructive">{row.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4">
          {allDone ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {tActions("close")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                {tActions("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleRegister}
                disabled={saving || reading || ready.length === 0}
                loading={saving}
              >
                {t("register", { count: ready.length })}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
