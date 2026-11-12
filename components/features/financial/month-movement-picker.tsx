"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Landmark } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { formatEuro } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/format-date";

interface WaitingMovement {
  id: string;
  amount: number;
  bookingDate: string;
  counterpartyName: string | null;
  reference: string | null;
  status: string;
  receiptId: string | null;
  bankAccount: { label: string };
}

interface ActionResult {
  status: string;
  receiptId: string | null;
  recordedPayments?: { id: string; date: string; amount: number }[];
}

interface Props {
  leaseId: string;
  year: number;
  month: number;
  /** What the month still owes: the movements closest to it come first. */
  owed: number;
  onAssigned: () => void;
}

const WAITING = new Set(["needs_review", "imported"]);

/**
 * **Associar movimento**: the incoming bank movements still waiting, for a month the matching did
 * not fill. The ones closest to what the month owes come first; choosing one assigns it to this
 * contract and fills this month first (`referenceMonth`), as Atribuir does in Movimentos. When the
 * contract has a payment recorded by hand of the same amount, the owner says whether it is that one.
 */
export function MonthMovementPicker({ leaseId, year, month, owed, onAssigned }: Props) {
  const t = useTranslations("financial.matrix.movements");
  const locale = useLocale();
  const apiError = useApiError();
  const [movements, setMovements] = useState<WaitingMovement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{
    movementId: string;
    payments: NonNullable<ActionResult["recordedPayments"]>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch<WaitingMovement[]>("/api/bank/transactions?direction=in")
      .then((list) => {
        if (!live) return;
        const waiting = list.filter((m) => WAITING.has(m.status) && !m.receiptId);
        // Closest to what is owed first, then the most recent.
        waiting.sort(
          (a, b) =>
            Math.abs(a.amount - owed) - Math.abs(b.amount - owed) ||
            b.bookingDate.localeCompare(a.bookingDate),
        );
        setMovements(waiting);
      })
      .catch((err) => live && setError(apiError(err)));
    return () => {
      live = false;
    };
  }, [owed, apiError]);

  const referenceMonth = `${year}-${String(month).padStart(2, "0")}`;

  async function act(movementId: string, body: Record<string, unknown>) {
    setBusy(movementId);
    setError(null);
    try {
      const result = await apiFetch<ActionResult>(`/api/bank/transactions/${movementId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (result.recordedPayments?.length) {
        setRecorded({ movementId, payments: result.recordedPayments });
      } else {
        setRecorded(null);
        onAssigned();
      }
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  }

  const assign = (movementId: string, newPayment = false) =>
    act(movementId, {
      action: "reassign",
      leaseId,
      referenceMonth,
      ...(newPayment ? { newPayment: true } : {}),
    });

  if (error) {
    return (
      <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
        {error}
      </p>
    );
  }
  if (!movements) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("loading")}</p>;
  }
  if (movements.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("none")}</p>;
  }

  return (
    <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] text-sm">
      {movements.slice(0, 8).map((movement) => (
        <li key={movement.id} className="space-y-2 py-2">
          <div className="flex items-center gap-3">
            <Landmark
              className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate">
                {movement.counterpartyName || movement.reference || movement.bankAccount.label}
              </p>
              <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                {[formatDate(movement.bookingDate, locale), movement.bankAccount.label]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <span className="shrink-0 tabular-nums">{formatEuro(movement.amount)}</span>
            <Button
              size="sm"
              variant="outline"
              loading={busy === movement.id}
              disabled={busy !== null}
              onClick={() => void assign(movement.id)}
            >
              {t("assign")}
            </Button>
          </div>
          {recorded?.movementId === movement.id && (
            <div className="space-y-2 bg-[var(--semantic-warning-soft)] p-3 text-xs">
              <p>
                {t("recorded", {
                  date: formatDate(recorded.payments[0].date, locale),
                  amount: formatEuro(recorded.payments[0].amount),
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(movement.id, { action: "link", receiptId: recorded.payments[0].id })
                  }
                >
                  {t("samePayment")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void assign(movement.id, true)}
                >
                  {t("newPayment")}
                </Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
