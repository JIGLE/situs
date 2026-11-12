"use client";

import * as React from "react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { Panel } from "@/components/shared/panel";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExportButton } from "@/components/ui/export-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import type {
  OwnerStatement,
  PayoutRecord,
  PropertySplit,
  YearSplit,
} from "@/lib/services/owner-payouts/split";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError, wasReported } from "@/lib/utils/api-error";
import { formatEuro } from "@/lib/utils/currency";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import { formatDate } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/utils";

/** What the route sends: the split, with its dates as JSON strings. */
type Wire<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends (infer U)[] ? Wire<U>[] : T[K];
};
type Statement = Wire<OwnerStatement>;
type Payout = Wire<PayoutRecord>;
type Year = Omit<Wire<YearSplit>, "owners" | "properties"> & {
  owners: Statement[];
  properties: PropertySplit[];
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * **Repartição**: the rent collected for properties held with others, and what each owner is due.
 *
 * The account receives the whole rent of a shared property and pays the other owners their part,
 * usually at the end of the year. For the year shown, each owner's part is the rent received less
 * the property's expenses, split by the shares recorded on the property (dated, so a sale in June
 * splits the months either side by their own owners). Recording a payout takes it off what the
 * owner is still due; nothing else is stored, so a late payment or a forgotten expense moves it.
 */
export function OwnerSharesView(): React.ReactElement {
  const t = useTranslations("financial.ownerShares");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("actions");
  const locale = useLocale();
  const apiError = useApiError();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const confirmDialog = useConfirmDialog();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const percent = (value: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`;

  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [data, setData] = useState<Year | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<Statement | null>(null);
  // Shared properties by default: one the owner holds alone has nobody to pay.
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(
    async (y: number, all: boolean, quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        setData(await apiFetch<Year>(`/api/owner-payouts?year=${y}${all ? "&all=1" : ""}`));
      } catch (err) {
        setError(apiError(err));
        if (!quiet) setData(null);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [apiError],
  );

  useEffect(() => {
    void load(year, showAll);
  }, [year, showAll, load]);

  const toggle = (ownerId: string) =>
    setOpen((shown) => {
      const next = new Set(shown);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });

  function removePayout(owner: Statement, payout: Payout) {
    confirmDialog.confirm(
      {
        title: t("removeTitle"),
        description: t("removeDescription", {
          amount: formatEuro(payout.amount),
          name: owner.ownerName,
          date: formatDate(payout.paidAt, locale),
        }),
        confirmLabel: t("remove"),
        cancelLabel: tActions("cancel"),
        variant: "destructive",
      },
      async () => {
        try {
          await apiFetch(`/api/owner-payouts/${payout.id}`, csrfToken, "DELETE");
          toast.success(t("removed"));
          await load(year, showAll, true);
        } catch (err) {
          if (!wasReported(err)) toast.error(apiError(err));
        }
      },
    );
  }

  const propertyName = (id: string) =>
    data?.properties.find((property) => property.propertyId === id)?.propertyName ?? "—";
  const detailHref = (propertyId: string) =>
    withEntityDetail(pathname, searchParams.toString(), "property", propertyId);

  const balanceLabel = (owner: Statement) =>
    owner.balance > 0.004
      ? t("toPay", { amount: formatEuro(owner.balance) })
      : owner.balance < -0.004
        ? t("owesBack", { amount: formatEuro(-owner.balance) })
        : t("settled");

  const exportRows = (data?.owners ?? []).map((owner) => ({
    owner: owner.ownerName,
    properties: owner.propertyIds.map(propertyName).join(", "),
    income: owner.income.toFixed(2),
    expenses: owner.expenses.toFixed(2),
    net: owner.net.toFixed(2),
    paid: owner.paid.toFixed(2),
    balance: owner.balance.toFixed(2),
  }));

  return (
    <div className="space-y-6">
      {/* No heading: the tab label is this view's heading. One utility row, then the year's
          figures as a line of text (density rules 1, 2 and 4). */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setYear((y) => y - 1)}
              aria-label={tCommon("previousYear")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-12 text-center text-sm font-medium tabular-nums">{year}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setYear((y) => y + 1)}
              aria-label={tCommon("nextYear")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {/* A toggle button, not a switch: a Button is 44px tall on a phone, a switch is 24. */}
            <Button
              size="sm"
              variant={showAll ? "secondary" : "ghost"}
              aria-pressed={showAll}
              onClick={() => setShowAll((all) => !all)}
            >
              {t("showAll")}
            </Button>
            <ExportButton
              data={exportRows}
              filename={`owner-shares-${year}`}
              disabled={exportRows.length === 0}
              columns={[
                { key: "owner", label: t("colOwner") },
                { key: "properties", label: t("colProperties") },
                { key: "income", label: t("income") },
                { key: "expenses", label: t("expenses") },
                { key: "net", label: t("net") },
                { key: "paid", label: t("paid") },
                { key: "balance", label: t("balance") },
              ]}
            />
          </div>
        </div>
        {data && data.properties.length > 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {!showAll && data.soleOwnerProperties > 0 ? (
              <span className="block text-xs">
                {t("soleOwnerHidden", { count: data.soleOwnerProperties })}
              </span>
            ) : null}
            {t("income")}{" "}
            <span className="tabular-nums text-[var(--color-foreground)]">
              {formatEuro(data.income)}
            </span>
            {" · "}
            {t("expenses")}{" "}
            <span className="tabular-nums text-[var(--color-foreground)]">
              {formatEuro(data.expenses)}
            </span>
            {" · "}
            {t("net")}{" "}
            <span className="font-medium tabular-nums text-[var(--color-foreground)]">
              {formatEuro(data.net)}
            </span>
            {" · "}
            {t("outstanding")}{" "}
            <span className="font-medium tabular-nums text-[var(--color-foreground)]">
              {formatEuro(data.outstanding)}
            </span>
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">{tCommon("loading")}</p>
      ) : error ? (
        <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
          {error}
        </p>
      ) : !data || data.properties.length === 0 ? (
        <div className="border border-[var(--color-hairline)] bg-[var(--color-surface-solid)] p-6 text-sm text-[var(--color-muted-foreground)]">
          <p className="font-medium text-[var(--color-foreground)]">{t("emptyTitle", { year })}</p>
          <p className="mt-1">{t("emptyDescription")}</p>
          {!showAll && data && data.soleOwnerProperties > 0 ? (
            <p className="mt-1">{t("soleOwnerHidden", { count: data.soleOwnerProperties })}</p>
          ) : null}
        </div>
      ) : (
        <>
          <Panel title={t("byOwner")}>
            <ul className="divide-y divide-[var(--color-hairline)]">
              {data.owners.map((owner) => {
                const expanded = open.has(owner.ownerId);
                const detailsId = `owner-share-${owner.ownerId}`;
                return (
                  <li key={owner.ownerId}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggle(owner.ownerId)}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left md:min-h-9"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform",
                            !expanded && "-rotate-90",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--color-foreground)]">
                            {owner.ownerName}
                          </span>
                          <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                            {t("ownerLine", {
                              count: owner.propertyIds.length,
                              net: formatEuro(owner.net),
                            })}
                            {owner.paid > 0
                              ? ` · ${t("paidLine", { amount: formatEuro(owner.paid) })}`
                              : ""}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-between">
                        <span
                          className={cn(
                            "text-sm tabular-nums",
                            owner.balance > 0.004
                              ? "font-medium text-[var(--color-foreground)]"
                              : "text-[var(--color-muted-foreground)]",
                          )}
                        >
                          {balanceLabel(owner)}
                        </span>
                        <Button size="sm" variant="outline" onClick={() => setPaying(owner)}>
                          {t("recordPayout")}
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <div
                        id={detailsId}
                        className="space-y-3 bg-[var(--color-muted)]/30 px-4 py-3 text-sm md:pl-10"
                      >
                        <ul className="space-y-1">
                          {data.properties
                            .filter((property) => owner.propertyIds.includes(property.propertyId))
                            .map((property) => {
                              const part = property.owners.find(
                                (p) => p.ownerId === owner.ownerId,
                              )!;
                              return (
                                <li
                                  key={property.propertyId}
                                  className="flex items-baseline justify-between gap-3"
                                >
                                  <span className="min-w-0 truncate">
                                    {property.propertyName}{" "}
                                    <span className="text-xs text-[var(--color-muted-foreground)]">
                                      {part.percentages.map(percent).join(" → ")}
                                    </span>
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {formatEuro(part.net)}
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                        {owner.reimbursed > 0 ? (
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {t("reimbursedLine", { amount: formatEuro(owner.reimbursed) })}
                          </p>
                        ) : null}
                        <div>
                          <p className="text-xs font-medium text-[var(--color-muted-foreground)]">
                            {t("payouts")}
                          </p>
                          {owner.payouts.length === 0 ? (
                            <p className="text-xs text-[var(--color-muted-foreground)]">
                              {t("noPayouts")}
                            </p>
                          ) : (
                            <ul>
                              {owner.payouts.map((payout) => (
                                <li
                                  key={payout.id}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span className="min-w-0 truncate">
                                    {formatDate(payout.paidAt, locale)}
                                    {payout.note ? (
                                      <span className="text-[var(--color-muted-foreground)]">
                                        {" "}
                                        · {payout.note}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1">
                                    <span className="tabular-nums">
                                      {formatEuro(payout.amount)}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => removePayout(owner, payout)}
                                      aria-label={t("removePayout", {
                                        date: formatDate(payout.paidAt, locale),
                                      })}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title={t("byProperty")}>
            <ul className="divide-y divide-[var(--color-hairline)]">
              {data.properties.map((property) => (
                <li key={property.propertyId} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={detailHref(property.propertyId)}
                      scroll={false}
                      className="flex min-h-11 min-w-0 items-center truncate font-medium text-[var(--color-foreground)] hover:underline md:min-h-0"
                    >
                      {property.propertyName}
                    </Link>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {formatEuro(property.net)}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t("propertyLine", {
                      income: formatEuro(property.income),
                      expenses: formatEuro(property.expenses),
                    })}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {property.owners
                      .map(
                        (part) =>
                          `${part.ownerName} ${part.percentages.map(percent).join(" → ")} · ${formatEuro(part.net)}`,
                      )
                      .join("  ·  ")}
                  </p>
                  {property.sharesChanged ? (
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {t("sharesChanged")}
                    </p>
                  ) : null}
                  {property.unassigned ? (
                    <p className="text-xs text-[var(--semantic-warning-readable)]">
                      {t("unassigned", { amount: formatEuro(property.unassigned.net) })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <PayoutDialog
        owner={paying}
        year={year}
        onOpenChange={(isOpen) => !isOpen && setPaying(null)}
        onRecorded={() => void load(year, showAll, true)}
      />
      <ConfirmationDialog dialog={confirmDialog} />
    </div>
  );
}

/** **Registar pagamento** to one owner: the amount handed over, the day, and a note. */
function PayoutDialog({
  owner,
  year,
  onOpenChange,
  onRecorded,
}: {
  owner: Statement | null;
  year: number;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const t = useTranslations("financial.ownerShares");
  const tActions = useTranslations("actions");
  const apiError = useApiError();
  const toast = useToast();
  const { token: csrfToken } = useCsrf();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<"amount" | "date" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Each time it opens for an owner, it starts from what that owner is still due.
  const [forOwner, setForOwner] = useState<string | null>(null);
  if (owner && owner.ownerId !== forOwner) {
    setForOwner(owner.ownerId);
    setAmount(owner.balance > 0 ? owner.balance.toFixed(2).replace(".", ",") : "");
    setDate(today());
    setNote("");
    setProblem(null);
    setError(null);
  } else if (!owner && forOwner !== null) {
    setForOwner(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner) return;
    const value = Number(amount.replace(/\s/g, "").replace(",", "."));
    if (!(value > 0)) return setProblem("amount");
    if (!date || Number.isNaN(Date.parse(date))) return setProblem("date");
    setProblem(null);
    setError(null);
    setSaving(true);
    try {
      await apiFetch("/api/owner-payouts", csrfToken, "POST", {
        ownerId: owner.ownerId,
        year,
        amount: value,
        paidAt: date,
        note: note.trim() || null,
      });
      toast.success(t("recorded"));
      onOpenChange(false);
      onRecorded();
    } catch (err) {
      if (!wasReported(err)) setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={owner !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[var(--color-border)] bg-[var(--color-card)]">
        <DialogHeader>
          <DialogTitle>{t("payoutTitle", { name: owner?.ownerName ?? "" })}</DialogTitle>
          <DialogDescription>
            {owner ? t("payoutDescription", { year, amount: formatEuro(owner.balance) }) : null}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="owner-payout-amount">{t("amount")}</Label>
              <Input
                id="owner-payout-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={problem === "amount"}
              />
              {problem === "amount" ? (
                <p className="text-sm text-[var(--semantic-danger-readable)]">
                  {t("amountRequired")}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-payout-date">{t("date")}</Label>
              <Input
                id="owner-payout-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={problem === "date"}
              />
              {problem === "date" ? (
                <p className="text-sm text-[var(--semantic-danger-readable)]">
                  {t("dateRequired")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner-payout-note">{t("note")}</Label>
            <Textarea
              id="owner-payout-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[var(--semantic-danger-readable)]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tActions("cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("recordPayout")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
