"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileUp, Landmark, Plus, Trash2 } from "lucide-react";

import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RentMonth } from "@/lib/services/allocation/rent-matrix";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError, wasReported } from "@/lib/utils/api-error";
import { formatEuro } from "@/lib/utils/currency";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import { receiptLifecycleKey } from "@/lib/utils/receipt-labels";
import { rentPeriodStatusKey } from "@/lib/utils/rent-period-labels";
import { ReceiptUploadSheet } from "@/components/features/financas-import/receipt-upload-sheet";
import { MonthMovementPicker } from "./month-movement-picker";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { RECIBO_ICON, cellLook } from "./rent-status-styles";

/** `?month=<leaseId>:<yyyy-mm>`: the month sheet's address, so a link or the audit can open it. */
export interface MonthRef {
  leaseId: string;
  year: number;
  month: number;
}

export function parseMonthParam(value: string | null): MonthRef | null {
  const match = value ? /^([^:]+):(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const month = Number(match[3]);
  return month >= 1 && month <= 12 ? { leaseId: match[1], year: Number(match[2]), month } : null;
}

export function monthParam({ leaseId, year, month }: MonthRef): string {
  return `${leaseId}:${year}-${String(month).padStart(2, "0")}`;
}

interface Props {
  /** The month shown. It stays set while the sheet closes, so the sheet leaves with its content. */
  monthRef: MonthRef | null;
  open: boolean;
  onClose: () => void;
  /** Called after a payment is recorded here, so the matrix reloads. */
  onChanged: () => void;
}

/**
 * One lease's month: what was due, what paid it, and **Registar pagamento** while something is
 * owed. Full-screen on a phone, a centred dialog from `md` up.
 */
export function RentMonthSheet({ monthRef, open, onClose, onChanged }: Props) {
  const t = useTranslations("financial.matrix");
  const tPeriod = useTranslations("rentPeriodStatus");
  const tReceipts = useTranslations("financial.receipts");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const apiError = useApiError();
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const [data, setData] = useState<RentMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickingMovement, setPickingMovement] = useState(false);

  const load = useCallback(
    async (ref: MonthRef) => {
      setError(null);
      try {
        const query = new URLSearchParams({
          leaseId: ref.leaseId,
          year: String(ref.year),
          month: String(ref.month),
        });
        setData(await apiFetch<RentMonth>(`/api/finance/rent-matrix/month?${query}`));
      } catch (err) {
        setData(null);
        setError(apiError(err));
      }
    },
    [apiError],
  );

  // Each opening is a new month reference, so the month is read afresh every time it opens.
  useEffect(() => {
    if (!monthRef) return;
    setData(null);
    setPickingMovement(false);
    void load(monthRef);
  }, [monthRef, load]);

  const reload = () => {
    if (monthRef) void load(monthRef);
    onChanged();
  };

  type Payment = RentMonth["payments"][number];

  /**
   * Take a payment's recibo off the month (and the payment, when the recibo recorded it), or a
   * payment recorded by hand. A bank movement's payment is undone from the movement, not here.
   */
  const askRemove = (payment: Payment) => {
    const receipt = payment.receipt;
    if (!receipt) return;
    const recibo = receipt.financasNumber != null;
    confirmDialog.confirm(
      {
        title: recibo
          ? receipt.financasNumber
            ? t("removeReciboTitle", { number: receipt.financasNumber })
            : t("removeReciboTitleNoNumber")
          : t("removePaymentTitle"),
        description: recibo
          ? t("removeReciboDescription")
          : t("removePaymentDescription", {
              amount: formatEuro(receipt.amount),
              date: formatDate(receipt.date, locale),
            }),
        confirmLabel: recibo ? t("removeRecibo") : t("removePayment"),
        cancelLabel: tActions("cancel"),
        variant: "destructive",
      },
      async () => {
        try {
          if (recibo) {
            const query = new URLSearchParams({ receiptId: receipt.id });
            await apiFetch(`/api/receipts/financas?${query}`, { method: "DELETE" });
          } else {
            await apiFetch(`/api/receipts/${receipt.id}`, { method: "DELETE" });
          }
          toast.success(recibo ? t("reciboRemoved") : t("paymentRemoved"));
          reload();
        } catch (err) {
          if (!wasReported(err)) toast.error(apiError(err));
        }
      },
    );
  };

  const period = data?.period ?? null;
  const statusKey = rentPeriodStatusKey(period?.status);
  const owed = period ? period.outstanding : 0;
  const canRecord = Boolean(data && owed > 0);
  // Every payment on the month has its recibo from Finanças on file.
  const receiptOnFile = Boolean(
    data?.payments.length && data.payments.every((p) => p.receipt?.financasNumber != null),
  );
  const canUpload = Boolean(period) && !receiptOnFile;
  const look = period ? cellLook(period.status, receiptOnFile) : null;
  return (
    <>
      <Sheet open={open && monthRef !== null} onOpenChange={(next) => !next && onClose()}>
        <SheetContent side="center" className="flex flex-col gap-0 overflow-y-auto p-0">
          <SheetHeader className="border-b border-[var(--color-border)] px-5 py-4 text-left">
            <SheetTitle>
              {data?.lease.tenantName ?? tCommon("loading")}
              {monthRef ? ` · ${formatMonthYear(monthRef.year, monthRef.month, locale)}` : ""}
            </SheetTitle>
            <SheetDescription>{data?.lease.propertyName ?? ""}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 px-5 py-4">
            {error ? (
              <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
                {error}
              </p>
            ) : !data ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{tCommon("loading")}</p>
            ) : !period ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">{t("noPeriod")}</p>
            ) : (
              <>
                <span className={`inline-block px-2 py-1 text-sm font-medium ${look?.style ?? ""}`}>
                  {statusKey ? tPeriod(statusKey) : period.status}
                  {receiptOnFile ? ` · ${t("reciboOnFile")}` : ""}
                </span>

                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-[var(--color-muted-foreground)]">{t("due")}</dt>
                    <dd className="mt-1 tabular-nums">{formatEuro(period.dueAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-muted-foreground)]">{t("paid")}</dt>
                    <dd className="mt-1 tabular-nums">{formatEuro(period.allocatedAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--color-muted-foreground)]">{t("owed")}</dt>
                    <dd className="mt-1 font-medium tabular-nums">{formatEuro(owed)}</dd>
                  </div>
                </dl>

                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                    {t("payments")}
                  </h3>
                  {data.payments.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {t("noPayments")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border)] text-sm">
                      {data.payments.map((payment, index) => {
                        const stage = receiptLifecycleKey(payment.receipt?.lifecycle);
                        const paidOn = payment.receipt?.date ?? payment.allocatedAt;
                        // Where the money came from: the bank movement it is linked to, or nothing
                        // but the owner's word when it was recorded by hand.
                        const origins = payment.movements.map((movement) =>
                          [
                            movement.bookingDate === paidOn
                              ? t("viaBank")
                              : t("viaBankOn", { date: formatDate(movement.bookingDate, locale) }),
                            movement.counterpartyName,
                            movement.accountLabel,
                            movement.reference,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        );
                        const byHand =
                          payment.receipt?.source === "manual" &&
                          payment.receipt.financasNumber == null &&
                          payment.movements.length === 0;
                        const removable =
                          payment.receipt != null &&
                          (payment.receipt.financasNumber != null || byHand);
                        if (
                          origins.length === 0 &&
                          (payment.receipt?.source === "manual" ||
                            payment.receipt?.source === "financas")
                        ) {
                          origins.push(
                            payment.receipt.financasNumber != null
                              ? t("fromRecibo")
                              : t("recordedByHand"),
                          );
                        }
                        return (
                          <li key={payment.receipt?.id ?? index} className="py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span>
                                {formatDate(paidOn, locale)}
                                {stage ? (
                                  <span className="text-[var(--color-muted-foreground)]">
                                    {" "}
                                    · {tReceipts(stage)}
                                  </span>
                                ) : null}
                              </span>
                              <span className="tabular-nums">{formatEuro(payment.amount)}</span>
                            </div>
                            {payment.receipt?.financasNumber != null ? (
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--semantic-success-readable)]">
                                <RECIBO_ICON className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                {payment.receipt.financasNumber
                                  ? t("reciboNumber", { number: payment.receipt.financasNumber })
                                  : t("reciboOnFile")}
                              </p>
                            ) : null}
                            {origins.map((origin, line) => (
                              <p
                                key={line}
                                className="mt-0.5 break-words text-xs text-[var(--color-muted-foreground)]"
                              >
                                {origin}
                              </p>
                            ))}
                            {removable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="-ml-2 mt-1 text-[var(--semantic-danger-readable)]"
                                onClick={() => askRemove(payment)}
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                {payment.receipt?.financasNumber != null
                                  ? t("removeRecibo")
                                  : t("removePayment")}
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {pickingMovement && canRecord ? (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                      {t("movements.title")}
                    </h3>
                    <MonthMovementPicker
                      leaseId={data.lease.id}
                      year={period.year}
                      month={period.month}
                      owed={owed}
                      onAssigned={() => {
                        setPickingMovement(false);
                        reload();
                      }}
                    />
                  </section>
                ) : null}

                {canRecord && data.olderUnpaid && !pickingMovement ? (
                  <p className="text-sm text-[var(--semantic-warning-readable)]">
                    {t("coversOlderFirst", {
                      month: formatMonthYear(data.olderUnpaid.year, data.olderUnpaid.month, locale),
                    })}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {canRecord || canUpload ? (
            <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-5 py-4 md:flex-row md:flex-wrap">
              {canRecord ? (
                <Button className="w-full md:w-auto" onClick={() => setRecording(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("recordPayment")}
                </Button>
              ) : null}
              {canRecord && !pickingMovement ? (
                <Button
                  variant="outline"
                  className="w-full md:w-auto"
                  onClick={() => setPickingMovement(true)}
                >
                  <Landmark className="mr-2 h-4 w-4" />
                  {t("movements.open")}
                </Button>
              ) : null}
              {canUpload ? (
                <Button
                  variant="outline"
                  className="w-full md:w-auto"
                  onClick={() => setUploading(true)}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  {t("uploadRecibo")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <RecordPaymentDialog
        open={recording}
        onOpenChange={setRecording}
        preset={data ? { leaseId: data.lease.id, amount: owed || undefined } : undefined}
        onRecorded={reload}
      />

      <ConfirmationDialog dialog={confirmDialog} />

      <ReceiptUploadSheet
        open={uploading}
        onOpenChange={setUploading}
        preset={monthRef ?? undefined}
        onRegistered={reload}
      />
    </>
  );
}
