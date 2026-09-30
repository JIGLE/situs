"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileDown, FlaskConical, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import type { AtCallView } from "@/lib/services/tax/at-connection";
import type {
  AtReceiptMonth,
  AtReceiptPreview,
  AtReceiptTestEntry,
  AtReceiptTestMonth,
} from "@/lib/services/tax/at-receipts";
import { MAX_TEST_MONTHS, type AtLandlord, type AtTenant } from "@/lib/tax/at/receipt-request";
import type { AtFieldError } from "@/lib/tax/at/soap";
import { TEST_MODES } from "@/lib/tax/connectors/modes";
import type { Receipt } from "@/lib/types";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { AT_PROBLEM_KEY } from "@/lib/utils/at-call-labels";
import { AT_BLOCKER_KEY, AT_REFUSAL_KEY } from "@/lib/utils/at-receipt-labels";
import { countryName } from "@/lib/utils/countries";
import { downloadBase64Pdf } from "@/lib/utils/download-pdf";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";

export interface AtReceiptsSheetProps {
  onClose: () => void;
  /** The chosen receipts, in the order the list shows them. */
  receipts: Receipt[];
  /** Issues them in Situs, as Emitir always has. */
  onIssue: () => void;
  issuing: boolean;
}

/** A test's answers, by receipt and rent month. */
type Results = Map<string, AtReceiptTestMonth>;

const resultKey = (receiptId: string, periodId: string) => `${receiptId}/${periodId}`;

const MUTED = "text-[var(--color-muted-foreground)]";
const DANGER = "text-[var(--semantic-danger-readable)]";
const SUCCESS = "text-[var(--semantic-success-readable)]";

/**
 * Finanças › Recibos: what the chosen receipts would send to Finanças, shown before anything
 * happens. Mounted when the owner presses **Emitir**, so each opening starts from what the server
 * says now.
 *
 * For each rent month a receipt pays: the month, the amount and the day it arrived, the lease's AT
 * contract number, and the landlords and tenants by NIF or document, then what stops the month
 * going, in words. **Emitir** issues the receipts in Situs, as it always has. In the test mode,
 * **Testar na AT** sends the months that are ready to AT's test service and shows what AT said
 * under each; the receipts themselves do not change, because a receipt issued there does not count.
 */
export function AtReceiptsSheet({ onClose, receipts, onIssue, issuing }: AtReceiptsSheetProps) {
  const t = useTranslations("financial.receipts");
  const tSheet = useTranslations("financial.receipts.atSheet");
  const tAt = useTranslations("settings.at");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const apiError = useApiError();
  const { formatCurrency } = useCurrency();
  const { token: csrfToken } = useCsrf();

  const [preview, setPreview] = useState<AtReceiptPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);

  // Keyed by the ids, not the array: the list hands a new array on every render.
  const idsKey = receipts.map((receipt) => receipt.id).join(",");
  const ids = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);

  useEffect(() => {
    // The review is a POST, which needs the CSRF token; it arrives shortly after the page does.
    if (!csrfToken || ids.length === 0) return;
    let cancelled = false;
    apiFetch<AtReceiptPreview>("/api/tax/connectors/at/receipts/preview", csrfToken, "POST", {
      receiptIds: ids,
    })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(apiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [csrfToken, ids, apiError]);

  const entryOf = (receiptId: string) =>
    preview?.receipts.find((entry) => entry.receiptId === receiptId);

  /** The receipts that have a month ready to go, and how many months that is. */
  const ready = (preview?.receipts ?? []).filter(
    (entry) => !entry.refusal && entry.months.some((month) => month.blockers.length === 0),
  );
  const readyMonths = ready.flatMap((entry) =>
    entry.months.filter((month) => month.blockers.length === 0),
  ).length;
  const inTestMode = preview !== null && TEST_MODES.has(preview.mode);

  /** AT's answer about the connection rather than the receipt, in the owner's words. */
  const describeProblem = (call: AtCallView): string => {
    switch (call.outcome) {
      case "answer":
        if (call.category === "unknown") return tAt("result.otherCode", { code: call.code });
        // Only a fetch reaches here with these: AT had no such receipt to give.
        if (call.category === "ok" || call.category === "rejected") return tAt("result.notFound");
        return tAt(AT_PROBLEM_KEY[call.category]);
      case "fault":
        return tAt("result.fault", { fault: call.faultString });
      case "not_sent":
        return tAt("result.notSent");
      case "unknown":
        return tAt("result.noAnswer");
    }
  };

  const runTest = async () => {
    setTesting(true);
    setNotice(null);
    try {
      const answer = await apiFetch<{ receipts: AtReceiptTestEntry[] }>(
        "/api/tax/connectors/at/receipts/test",
        csrfToken,
        "POST",
        { receiptIds: ready.slice(0, MAX_TEST_MONTHS).map((entry) => entry.receiptId) },
      );
      const next: Results = new Map();
      for (const entry of answer.receipts) {
        for (const month of entry.months)
          next.set(resultKey(entry.receiptId, month.periodId), month);
      }
      setResults(next);
    } catch (err) {
      setNotice(apiError(err));
    } finally {
      setTesting(false);
    }
  };

  const fetchPdf = async (key: string, contractNumber: string, receiptNumber: number) => {
    setFetching(key);
    setNotice(null);
    try {
      const answer = await apiFetch<{ call: AtCallView; pdf?: string }>(
        "/api/tax/connectors/at/receipt",
        csrfToken,
        "POST",
        { contractNumber: Number(contractNumber), receiptNumber },
      );
      if (answer.pdf) {
        downloadBase64Pdf(answer.pdf, `recibo-${contractNumber}-${receiptNumber}.pdf`);
      } else {
        setNotice(describeProblem(answer.call));
      }
    } catch (err) {
      setNotice(apiError(err));
    } finally {
      setFetching(null);
    }
  };

  const personLine = (person: AtLandlord | AtTenant) => {
    const tenant = "country" in person ? person : null;
    if (tenant && (tenant.country || "PT") !== "PT") {
      return tenant.document
        ? tSheet("byDocument", {
            name: tenant.name,
            document: tenant.document,
            country: countryName(tenant.country ?? "", locale),
          })
        : tSheet("noId", { name: tenant.name });
    }
    return person.nif
      ? tSheet("byNif", { name: person.name, nif: person.nif })
      : tSheet("noId", { name: person.name });
  };

  const resultLine = (key: string, month: AtReceiptMonth) => {
    const result = results?.get(key);
    if (!result || result.status === "blocked") return null;
    if (result.status === "skipped") {
      return <p className={`text-xs ${MUTED}`}>{tSheet("result.skipped")}</p>;
    }
    const { call, receiptNumber } = result;
    const contractNumber = month.contractNumber;
    if (call.outcome === "answer" && call.category === "ok") {
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className={`text-xs ${SUCCESS}`}>
            {tSheet("result.issued", { number: receiptNumber ?? "—" })}
          </p>
          {receiptNumber !== null && contractNumber ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              loading={fetching === key}
              onClick={() => fetchPdf(key, contractNumber, receiptNumber)}
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              {tSheet("result.fetchPdf")}
            </Button>
          ) : null}
        </div>
      );
    }
    if (call.outcome === "answer" && call.category === "rejected") {
      // AT's own words, in Portuguese, field by field; its message when it named no field.
      const errors: AtFieldError[] =
        call.errors.length > 0 ? call.errors : [{ message: call.message }];
      return (
        <div className={`text-xs ${DANGER}`}>
          <p>{tSheet("result.refused")}</p>
          <ul className="list-disc pl-4">
            {errors.map((error, index) => (
              <li key={index}>
                {error.field ? `${error.field}: ` : ""}
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className={`text-xs ${DANGER}`}>
        <p>{describeProblem(call)}</p>
        {call.outcome === "answer" && call.message ? (
          <p className={MUTED}>{tAt("atSays", { message: call.message })}</p>
        ) : null}
      </div>
    );
  };

  const monthItem = (receiptId: string, month: AtReceiptMonth) => {
    const key = resultKey(receiptId, month.periodId);
    return (
      <li key={month.periodId} className="space-y-1.5 py-3">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="font-medium first-letter:uppercase">
            {formatMonthYear(month.year, month.month, locale)}
          </span>
          <span className="tabular-nums">{formatCurrency(month.amount)}</span>
        </p>
        <p className={`text-xs ${MUTED}`}>
          {tSheet("received", { date: formatDate(month.receivedOn, locale) })}
          {month.contractNumber
            ? ` · ${
                month.contractVersion
                  ? tSheet("contractVersion", {
                      number: month.contractNumber,
                      version: month.contractVersion,
                    })
                  : tSheet("contract", { number: month.contractNumber })
              }`
            : ""}
        </p>
        {month.landlords.length > 0 ? (
          <p className="text-xs">
            <span className={MUTED}>{tSheet("landlords")}: </span>
            {month.landlords.map(personLine).join(" · ")}
          </p>
        ) : null}
        {month.tenants.length > 0 ? (
          <p className="text-xs">
            <span className={MUTED}>{tSheet("tenants")}: </span>
            {month.tenants.map(personLine).join(" · ")}
          </p>
        ) : null}
        {month.blockers.length > 0 ? (
          <div className={`text-xs ${DANGER}`}>
            <p className="font-medium">{tSheet("missing")}</p>
            <ul className="list-disc pl-4">
              {month.blockers.map((blocker, index) => (
                <li key={index}>
                  {tSheet(AT_BLOCKER_KEY[blocker.code], { name: blocker.name ?? "" })}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={`text-xs ${SUCCESS}`}>{tSheet("ready")}</p>
        )}
        {resultLine(key, month)}
      </li>
    );
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="center" className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-[var(--color-border)] px-5 py-4 text-left">
          <SheetTitle>{t("issueDialog.title", { count: receipts.length })}</SheetTitle>
          <SheetDescription>
            {preview === null ? "" : inTestMode ? tSheet("modeTest") : tSheet("modeSimulated")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadError ? (
            <p role="alert" className={`text-sm ${DANGER}`}>
              {loadError}
            </p>
          ) : preview === null ? (
            <p className={`text-sm ${MUTED}`}>{tCommon("loading")}</p>
          ) : (
            <>
              {results ? (
                <p role="status" className={`text-sm ${MUTED}`}>
                  {tSheet("result.nothingRecorded")}
                </p>
              ) : null}
              {notice ? (
                <p role="alert" className={`text-sm ${DANGER}`}>
                  {notice}
                </p>
              ) : null}
              <ul className="space-y-4">
                {receipts.map((receipt) => {
                  const entry = entryOf(receipt.id);
                  if (!entry) return null;
                  return (
                    <li
                      key={receipt.id}
                      className="border border-[var(--color-border)] px-4 py-3"
                      data-testid="at-sheet-receipt"
                    >
                      <p className="text-sm font-medium">
                        {receipt.tenantName}
                        <span className={`font-normal ${MUTED}`}> · {receipt.propertyName}</span>
                      </p>
                      {entry.refusal ? (
                        <p className={`mt-1 text-xs ${MUTED}`}>
                          {tSheet(AT_REFUSAL_KEY[entry.refusal])}
                        </p>
                      ) : (
                        <ul className="divide-y divide-[var(--color-border)]">
                          {entry.months.map((month) => monthItem(receipt.id, month))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="space-y-3 border-t border-[var(--color-border)] px-5 py-4">
          <p className={`text-xs ${MUTED}`}>{t("issueDialog.description")}</p>
          {inTestMode && !preview.canTest ? (
            <p className={`text-xs ${MUTED}`}>{tSheet("testUnavailable")}</p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {inTestMode && preview.canTest ? (
              <Button
                variant="outline"
                className="gap-2"
                onClick={runTest}
                loading={testing}
                disabled={readyMonths === 0 || issuing}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                {tSheet("test", { count: Math.min(readyMonths, MAX_TEST_MONTHS) })}
              </Button>
            ) : null}
            <Button className="gap-2" onClick={onIssue} loading={issuing} disabled={testing}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {t("issueSelected", { count: receipts.length })}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
