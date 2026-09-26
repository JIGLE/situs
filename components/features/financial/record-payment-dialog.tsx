"use client";

import { useEffect, useEffectEvent, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import type { Receipt } from "@/lib/types";
import { useApiError, wasReported } from "@/lib/utils/api-error";
import { RECEIPT_TYPE_KEY } from "@/lib/utils/receipt-labels";

/** What opening the dialog from somewhere can fill in: a month in the rent matrix, say. */
export interface RecordPaymentPreset {
  leaseId?: string;
  /** Picks the lease when only the tenant (and perhaps the property) is known. */
  tenantId?: string;
  propertyId?: string;
  amount?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: RecordPaymentPreset;
  /** Called after the payment is saved, so whatever shows the rent months can reload them. */
  onRecorded?: () => void;
}

const TYPES = ["rent", "deposit", "maintenance", "other"] as const satisfies Receipt["type"][];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * **Registar pagamento**: money that reached the owner without a bank movement, such as cash.
 *
 * The payment is recorded against a lease rather than a tenant and a property picked apart, so
 * the ledger knows which contract's months it settles; allocation then fills that lease's
 * oldest unpaid month first. It is saved as paid: it records money that arrived. The form it
 * replaces saved every payment as pending, so the dashboard called it late five days later
 * while the ledger already counted the month as paid.
 */
export function RecordPaymentDialog({ open, onOpenChange, preset, onRecorded }: Props) {
  const t = useTranslations("financial.recordPayment");
  const tReceipts = useTranslations("financial.receipts");
  const tActions = useTranslations("actions");
  const apiError = useApiError();
  const { success } = useToast();
  const { state, addReceipt } = useApp();

  const leaseOptions = useMemo(
    () =>
      [...state.leases]
        .filter((lease) => lease.status !== "draft")
        .map((lease) => {
          const tenant = state.tenants.find((x) => x.id === lease.tenantId);
          const property = state.properties.find((x) => x.id === lease.propertyId);
          return {
            lease,
            label: `${tenant?.name ?? lease.tenantName ?? "—"} · ${property?.name ?? lease.propertyName ?? "—"}`,
          };
        })
        .sort(
          (a, b) =>
            Number(b.lease.status === "active") - Number(a.lease.status === "active") ||
            a.label.localeCompare(b.label),
        ),
    [state.leases, state.tenants, state.properties],
  );

  const [leaseId, setLeaseId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [type, setType] = useState<Receipt["type"]>("rent");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<"lease" | "amount" | "date" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Each opening starts from the preset: the lease it names, or the tenant's active lease, and
  // the amount it names, or that lease's rent.
  const reset = useEffectEvent(() => {
    const lease =
      leaseOptions.find(({ lease }) => lease.id === preset?.leaseId)?.lease ??
      leaseOptions.find(
        ({ lease }) =>
          preset?.tenantId !== undefined &&
          lease.tenantId === preset.tenantId &&
          (preset.propertyId === undefined || lease.propertyId === preset.propertyId) &&
          lease.status === "active",
      )?.lease;
    setLeaseId(lease?.id ?? "");
    const start = preset?.amount ?? lease?.monthlyRent;
    setAmount(start !== undefined ? String(start) : "");
    setDate(today());
    setType("rent");
    setDescription("");
    setProblem(null);
    setError(null);
  });
  useEffect(() => {
    if (open) reset();
  }, [open]);

  function chooseLease(id: string) {
    setLeaseId(id);
    // A lease picked by hand brings its rent, unless an amount has already been typed.
    if (amount === "") {
      const lease = leaseOptions.find(({ lease }) => lease.id === id)?.lease;
      if (lease) setAmount(String(lease.monthlyRent));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const lease = leaseOptions.find(({ lease }) => lease.id === leaseId)?.lease;
    const value = Number(amount.replace(",", "."));
    if (!lease) return setProblem("lease");
    if (!(value > 0)) return setProblem("amount");
    if (!date || Number.isNaN(Date.parse(date))) return setProblem("date");
    setProblem(null);
    setError(null);
    setSaving(true);
    try {
      await addReceipt({
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        leaseId: lease.id,
        amount: value,
        date,
        type,
        status: "paid",
        description: description.trim() || undefined,
      });
      success(t("recorded"));
      onOpenChange(false);
      onRecorded?.();
    } catch (err) {
      // `addReceipt` has already said why in a toast; the dialog stays open to fix it.
      if (!wasReported(err)) setError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-[var(--color-border)] bg-[var(--color-card)]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="record-payment-lease">{t("lease")}</Label>
            <Select value={leaseId} onValueChange={chooseLease}>
              <SelectTrigger
                id="record-payment-lease"
                aria-invalid={problem === "lease"}
                className={problem === "lease" ? "border-[var(--semantic-danger)]" : ""}
              >
                <SelectValue placeholder={t("chooseLease")} />
              </SelectTrigger>
              <SelectContent>
                {leaseOptions.map(({ lease, label }) => (
                  <SelectItem key={lease.id} value={lease.id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {problem === "lease" ? (
              <p className="text-sm text-[var(--semantic-danger-readable)]">{t("leaseRequired")}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="record-payment-amount">{t("amount")}</Label>
              <Input
                id="record-payment-amount"
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
              <Label htmlFor="record-payment-date">{tReceipts("paymentDate")}</Label>
              <Input
                id="record-payment-date"
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
            <Label htmlFor="record-payment-type">{tReceipts("paymentType")}</Label>
            <Select value={type} onValueChange={(value) => setType(value as Receipt["type"])}>
              <SelectTrigger id="record-payment-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tReceipts(RECEIPT_TYPE_KEY[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="record-payment-description">{tReceipts("descriptionOptional")}</Label>
            <Textarea
              id="record-payment-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
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
              {t("submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
