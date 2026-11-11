"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, FileCheck2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AtReceiptsSheet } from "@/components/features/financial/at-receipts-sheet";
import { useApp } from "@/lib/contexts/app-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useToast } from "@/lib/contexts/toast-context";
import type { Receipt } from "@/lib/types";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { INBOX_FILTER_QUERY, formatMovementAmount } from "@/lib/utils/bank-inbox";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import { isIssuable, receiptMonth } from "@/lib/utils/receipt-months";

/** A bank movement waiting for the owner, as `GET /api/bank/transactions` gives it. */
interface Movement {
  id: string;
  amount: number;
  currency: string;
  bookingDate: string;
  counterpartyName: string | null;
  suggestedLeaseId: string | null;
  matchConfidence: number | null;
  suggestedLease: { tenantName: string; propertyName: string } | null;
  recordedPayments?: { id: string }[];
}

const BANK = "/financials?tab=movements";

/**
 * The month's work, on Home: each payment that arrived waits as a card to confirm, and each paid
 * receipt as a card to mark issued once the owner has issued it on the Portal. Confirming makes
 * the receipt, so the same payment comes back as a receipt card.
 *
 * It replaced a list of counts that each sent the owner to another tab: Finance › Bank movements
 * to confirm, then Finance › Receipts to tick and issue, then a review sheet. Anything the card
 * cannot settle (no suggested tenant, or a payment that may already be recorded by hand) opens the
 * full movements list; a receipt Situs refuses to issue opens the review that says why.
 */
export function HomeInbox({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("dashboard.inbox");
  const tBank = useTranslations("financial.bank");
  const locale = useLocale();
  const apiError = useApiError();
  const toast = useToast();
  const { formatCurrency } = useCurrency();
  const { token: csrfToken } = useCsrf();
  const { state, refreshData } = useApp();

  const [movements, setMovements] = useState<Movement[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The receipts whose Portal details are open: one, or the one Situs refused. */
  const [reviewing, setReviewing] = useState<Receipt[] | null>(null);

  const loadMovements = useCallback(async () => {
    try {
      const rows = await apiFetch<Movement[]>(`/api/bank/transactions${INBOX_FILTER_QUERY.review}`);
      setMovements(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(apiError(err));
    }
  }, [apiError]);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const receipts = useMemo(
    () =>
      state.receipts
        .filter((receipt) => receipt.status === "paid" && isIssuable(receipt.lifecycle))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [state.receipts],
  );

  const settled = async () => {
    await refreshData();
    onChanged?.();
  };

  const act = async (movement: Movement, action: "confirm" | "ignore") => {
    setBusy(movement.id);
    setError(null);
    try {
      const result = await apiFetch<{ recordedPayments?: unknown[] }>(
        `/api/bank/transactions/${movement.id}`,
        csrfToken,
        "PUT",
        { action },
      );
      if ((result?.recordedPayments?.length ?? 0) > 0) {
        // The lease has a payment of this amount recorded by hand: which one it is, is the
        // movements list's question.
        toast.info(
          tBank("toast.heldForRecorded", { tenant: movement.suggestedLease?.tenantName ?? "—" }),
        );
      } else if (action === "confirm") {
        toast.success(t("confirmed", { tenant: movement.suggestedLease?.tenantName ?? "—" }));
      } else {
        toast.success(tBank("toast.ignored"));
      }
      await loadMovements();
      await settled();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  /** Marks receipts issued in Situs, one at a time; the first refusal opens the review. */
  const markIssued = async (batch: Receipt[]) => {
    setBusy(batch.length === 1 ? batch[0].id : "all");
    setError(null);
    let issued = 0;
    let refused: Receipt | null = null;
    for (const receipt of batch) {
      try {
        await apiFetch(`/api/receipts/${receipt.id}/lifecycle`, csrfToken, "PUT", {
          to: "emitted",
        });
        issued += 1;
      } catch (err) {
        refused = receipt;
        setError(`${receipt.tenantName}: ${apiError(err)}`);
        break;
      }
    }
    if (issued > 0) toast.success(t("issued", { count: issued }));
    await settled();
    setBusy(null);
    setReviewing(refused ? [refused] : null);
  };

  const monthOf = (receipt: Receipt) => {
    const [year, month] = receiptMonth(receipt).split("-").map(Number);
    return formatMonthYear(year, month, locale);
  };

  const count = movements.length + receipts.length;

  return (
    <section className="panel" data-testid="home-inbox" aria-labelledby="home-inbox-label">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <p id="home-inbox-label" className="mono-label">
          {t("title", { count })}
        </p>
        {receipts.length > 1 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void markIssued(receipts)}
          >
            {t("markAllIssued", { count: receipts.length })}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="border-b border-[var(--color-border)] px-4 py-2 text-sm text-[var(--semantic-danger-readable)]"
        >
          {error}
        </p>
      ) : null}

      {count === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {movements.map((movement) => {
            // A card settles only the plain case: one suggested tenant, nothing recorded by hand.
            const simple =
              movement.suggestedLease !== null && (movement.recordedPayments?.length ?? 0) === 0;
            return (
              <li
                key={movement.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t("paymentFrom", {
                      amount: formatMovementAmount(movement.amount, movement.currency),
                      payer: movement.counterpartyName ?? t("unknownPayer"),
                    })}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {movement.suggestedLease
                      ? t("paymentFor", {
                          tenant: movement.suggestedLease.tenantName,
                          property: movement.suggestedLease.propertyName,
                        })
                      : tBank("noSuggestion")}
                    {" · "}
                    {formatDate(movement.bookingDate, locale)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {simple ? (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act(movement, "confirm")}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      {tBank("confirm")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={BANK}>{t("review")}</Link>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void act(movement, "ignore")}
                  >
                    {tBank("ignore")}
                  </Button>
                </div>
              </li>
            );
          })}
          {receipts.map((receipt) => (
            <li
              key={receipt.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t("receiptReady", {
                    tenant: receipt.tenantName,
                    amount: formatCurrency(receipt.amount),
                  })}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {receipt.propertyName} · {monthOf(receipt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void markIssued([receipt])}
                >
                  <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />
                  {t("markIssued")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReviewing([receipt])}>
                  {t("portalDetails")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {reviewing ? (
        <AtReceiptsSheet
          receipts={reviewing}
          issuing={busy !== null}
          onClose={() => setReviewing(null)}
          onIssue={() => void markIssued(reviewing)}
        />
      ) : null}
    </section>
  );
}
