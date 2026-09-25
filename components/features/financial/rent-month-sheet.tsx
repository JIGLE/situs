"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RentMonth } from "@/lib/services/allocation/rent-matrix";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatEuro } from "@/lib/utils/currency";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import { receiptLifecycleKey } from "@/lib/utils/receipt-labels";
import { rentPeriodStatusKey } from "@/lib/utils/rent-period-labels";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { CELL_STYLES } from "./rent-status-styles";

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
  const locale = useLocale();
  const apiError = useApiError();
  const [data, setData] = useState<RentMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

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
    void load(monthRef);
  }, [monthRef, load]);

  const period = data?.period ?? null;
  const statusKey = rentPeriodStatusKey(period?.status);
  const owed = period ? period.outstanding : 0;
  const canRecord = Boolean(data && owed > 0);

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
                <span
                  className={`inline-block px-2 py-1 text-sm font-medium ${CELL_STYLES[period.status] ?? ""}`}
                >
                  {statusKey ? tPeriod(statusKey) : period.status}
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
                        return (
                          <li
                            key={payment.receipt?.id ?? index}
                            className="flex items-center justify-between gap-3 py-2"
                          >
                            <span>
                              {formatDate(payment.receipt?.date ?? payment.allocatedAt, locale)}
                              {stage ? (
                                <span className="text-[var(--color-muted-foreground)]">
                                  {" "}
                                  · {tReceipts(stage)}
                                </span>
                              ) : null}
                            </span>
                            <span className="tabular-nums">{formatEuro(payment.amount)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {canRecord && data.olderUnpaid ? (
                  <p className="text-sm text-[var(--semantic-warning-readable)]">
                    {t("coversOlderFirst", {
                      month: formatMonthYear(data.olderUnpaid.year, data.olderUnpaid.month, locale),
                    })}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {canRecord ? (
            <div className="border-t border-[var(--color-border)] px-5 py-4">
              <Button className="w-full md:w-auto" onClick={() => setRecording(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("recordPayment")}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <RecordPaymentDialog
        open={recording}
        onOpenChange={setRecording}
        preset={data ? { leaseId: data.lease.id, amount: owed || undefined } : undefined}
        onRecorded={() => {
          if (monthRef) void load(monthRef);
          onChanged();
        }}
      />
    </>
  );
}
