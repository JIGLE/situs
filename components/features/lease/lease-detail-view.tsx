"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  FileText,
  Edit,
  ArrowLeft,
  Calendar,
  RotateCcw,
  XCircle,
  CheckCircle2,
  Clock,
  Ban,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/utils";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RECEIPT_TYPE_KEY } from "@/lib/utils/receipt-labels";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { EntityLink } from "@/components/shared/entity-link";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { csrfHeaders } from "@/lib/utils/api-client";

interface LeaseDetailViewProps {
  leaseId: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  pending: "secondary",
  expired: "destructive",
  terminated: "destructive",
};

export function LeaseDetailView({ leaseId }: LeaseDetailViewProps) {
  const { state, updateLease } = useApp();
  const { formatCurrency } = useCurrency();
  const { success, error } = useToast();
  const t = useTranslations("leases.detail");
  const tLease = useTranslations("leases");
  const tForms = useTranslations("forms");
  const tActions = useTranslations("actions");
  const tStatus = useTranslations("status");
  const tReceipts = useTranslations("financial.receipts");
  const locale = useLocale();
  const confirmDialog = useConfirmDialog();
  const router = useRouter();

  // Renewal offer dialog state
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [renewalSubmitting, setRenewalSubmitting] = useState(false);

  const lease = state.leases.find((l) => l.id === leaseId);

  // Related entities
  const property = lease ? state.properties.find((p) => p.id === lease.propertyId) : null;
  const tenant = lease ? state.tenants.find((t) => t.id === lease.tenantId) : null;
  const relatedReceipts = useMemo(
    () =>
      lease
        ? state.receipts.filter(
            (r) => r.propertyId === lease.propertyId && r.tenantId === lease.tenantId,
          )
        : [],
    [state.receipts, lease],
  );

  if (!lease) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-[var(--color-muted-foreground)]">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/leases")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("backToLeases")}
        </Button>
      </div>
    );
  }

  const daysUntilExpiry = Math.ceil(
    (new Date(lease.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  const totalPaid = relatedReceipts
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.amount, 0);

  const handleEdit = () => {
    router.push(`/leases?action=edit&id=${lease.id}`);
  };

  const handleRenew = () => setRenewalOpen(true);

  const handleRenewalSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!lease) return;
    const fd = new FormData(e.currentTarget);
    setRenewalSubmitting(true);
    try {
      const res = await fetch(`/api/leases/${lease.id}/renewal`, {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          proposedRent: fd.get("proposedRent") ? Number(fd.get("proposedRent")) : undefined,
          startDate: fd.get("startDate") || undefined,
          endDate: fd.get("endDate") || undefined,
          notes: fd.get("notes") || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      await updateLease(lease.id, updated);
      success(t("toastRenewalSent"));
      setRenewalOpen(false);
    } catch {
      error(t("toastRenewalFailed"));
    } finally {
      setRenewalSubmitting(false);
    }
  };

  const handleRenewalWithdraw = async () => {
    if (!lease) return;
    try {
      const res = await fetch(`/api/leases/${lease.id}/renewal`, {
        method: "DELETE",
        headers: csrfHeaders(),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      await updateLease(lease.id, updated);
      success(t("toastRenewalWithdrawn"));
    } catch {
      error(t("toastWithdrawFailed"));
    }
  };

  const handleTerminate = () => {
    confirmDialog.confirm(
      {
        title: t("terminateDialog.title"),
        description: t("terminateDialog.description"),
        confirmLabel: t("terminateDialog.confirmLabel"),
        variant: "destructive",
      },
      async () => {
        try {
          await updateLease(lease.id, { status: "terminated" });
          success(t("toastTerminated"));
          router.push("/leases");
        } catch {
          error(t("toastTerminateFailed"));
        }
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-violet-500/10">
            <FileText className="h-8 w-8 text-violet-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
              Lease {lease.id.slice(0, 8)}
            </h1>
            <div className="flex items-center gap-2 mt-1 text-sm text-[var(--color-muted-foreground)]">
              <Calendar className="h-4 w-4" />
              <span>
                {lease.startDate} — {lease.endDate}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <Badge variant={STATUS_VARIANT[lease.status] || "secondary"}>
                {/* The list view translates this; the detail view printed the stored enum, so
                    the same lease read "Ativo" on one screen and "active" on the other. */}
                {tLease(lease.status)}
              </Badge>
              <span className="text-sm font-medium">
                {tLease("perMonth", { amount: formatCurrency(lease.monthlyRent) })}
              </span>
              {lease.autoRenew && <Badge variant="outline">{t("autoRenewBadge")}</Badge>}
              {lease.status === "active" && daysUntilExpiry <= 60 && (
                <Badge variant="secondary" className="text-amber-500">
                  {t("expiresIn", { days: daysUntilExpiry })}
                </Badge>
              )}
              {lease.renewalStatus === "offered" && (
                <Badge variant="secondary" className="gap-1 text-sky-600 dark:text-sky-400">
                  <Clock className="h-3 w-3" /> {t("renewalOffered")}
                </Badge>
              )}
              {lease.renewalStatus === "accepted" && (
                <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> {t("renewalAccepted")}
                </Badge>
              )}
              {lease.renewalStatus === "declined" && (
                <Badge variant="secondary" className="gap-1 text-[var(--color-destructive)]">
                  <Ban className="h-3 w-3" /> Renewal declined
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lease.status === "active" && (
            <>
              {!lease.renewalStatus || lease.renewalStatus === "declined" ? (
                <Button variant="outline" size="sm" onClick={handleRenew}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Offer Renewal
                </Button>
              ) : lease.renewalStatus === "offered" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRenewalWithdraw}
                  className="text-[var(--color-muted-foreground)]"
                >
                  <XCircle className="h-4 w-4 mr-1" /> Withdraw Offer
                </Button>
              ) : null}
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleEdit}>
            <Edit className="h-4 w-4 mr-1" /> Edit
          </Button>
        </div>
      </div>

      {/* Linked Entities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {property && (
          <EntityLink
            type="property"
            id={property.id}
            title={property.name}
            subtitle={property.address}
            status={property.status}
            statusVariant={
              property.status === "occupied"
                ? "success"
                : property.status === "vacant"
                  ? "warning"
                  : "destructive"
            }
            variant="full"
          />
        )}
        {tenant && (
          <EntityLink
            type="tenant"
            id={tenant.id}
            title={tenant.name}
            subtitle={`${tenant.email} · ${tenant.phone}`}
            status={tenant.paymentStatus}
            statusVariant={
              tenant.paymentStatus === "paid"
                ? "success"
                : tenant.paymentStatus === "overdue"
                  ? "destructive"
                  : "warning"
            }
            variant="full"
          />
        )}
      </div>

      {/* Lease Terms */}
      <Card>
        <CardHeader>
          <CardTitle>{t("terms")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <div>
              <span className="text-[var(--color-muted-foreground)]">
                {tLease("field.monthlyRent")}
              </span>
              <p className="text-lg font-semibold mt-1">{formatCurrency(lease.monthlyRent)}</p>
            </div>
            <div>
              <span className="text-[var(--color-muted-foreground)]">
                {tLease("field.deposit")}
              </span>
              <p className="text-lg font-semibold mt-1">{formatCurrency(lease.deposit)}</p>
            </div>
            <div>
              <span className="text-[var(--color-muted-foreground)]">
                {tLease("field.startDate")}
              </span>
              <p className="text-lg font-semibold mt-1">{lease.startDate}</p>
            </div>
            <div>
              <span className="text-[var(--color-muted-foreground)]">
                {tLease("field.endDate")}
              </span>
              <p className="text-lg font-semibold mt-1">{lease.endDate}</p>
            </div>
            {lease.taxRegime && (
              <div>
                <span className="text-[var(--color-muted-foreground)]">
                  {tLease("field.taxRegime")}
                </span>
                <p className="font-medium mt-1">{lease.taxRegime}</p>
              </div>
            )}
            <div>
              <span className="text-[var(--color-muted-foreground)]">{t("autoRenewBadge")}</span>
              <p className="font-medium mt-1">{lease.autoRenew ? t("yes") : t("no")}</p>
            </div>
            <div>
              <span className="text-[var(--color-muted-foreground)]">{t("noticePeriod")}</span>
              <p className="font-medium mt-1">
                {t("noticeDays", { days: lease.renewalNoticeDays })}
              </p>
            </div>
          </div>

          {lease.notes && (
            <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-muted-foreground)]">
                {tForms("notes")}
              </span>
              <p className="text-sm mt-1">{lease.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Timeline */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("paymentHistory")}</CardTitle>
            <span className="text-sm text-[var(--color-muted-foreground)]">
              {t("totalPaid")}{" "}
              <span className="font-semibold text-green-500">{formatCurrency(totalPaid)}</span>
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {relatedReceipts.length === 0 ? (
            <EmptyStateIllustration entityType="receipts" />
          ) : (
            <div className="space-y-3">
              {relatedReceipts
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((receipt) => (
                  <div
                    key={receipt.id}
                    className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full",
                          receipt.status === "paid" ? "bg-green-500" : "bg-amber-500",
                        )}
                      />
                      <div>
                        {/* Was `capitalize` over the raw enum, which is a CSS rule standing in
                            for a translation: "Rent" in a Portuguese payment history. */}
                        <p className="text-sm font-medium">
                          {tReceipts(RECEIPT_TYPE_KEY[receipt.type])}
                        </p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {new Date(receipt.date).toLocaleDateString(locale)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={receipt.status === "paid" ? "default" : "secondary"}>
                        {tStatus(receipt.status)}
                      </Badge>
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          receipt.status === "paid"
                            ? "text-green-500"
                            : "text-[var(--color-foreground)]",
                        )}
                      >
                        {formatCurrency(receipt.amount)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
      {/* Danger Zone */}
      <div className="rounded-xl border border-red-800/30 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-red-500" />
          <h3 className="text-sm font-semibold text-red-500">{t("dangerZone")}</h3>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("terminateWarning")}</p>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleTerminate}
          disabled={lease.status === "terminated"}
        >
          <XCircle className="h-4 w-4 mr-1" /> {t("terminate")}
        </Button>
      </div>

      {/* Renewal Offer Dialog */}
      <Dialog open={renewalOpen} onOpenChange={setRenewalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("renewalTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenewalSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="proposedRent">{t("proposedRent")}</Label>
              <Input
                id="proposedRent"
                name="proposedRent"
                type="number"
                step="0.01"
                min="0"
                defaultValue={lease?.monthlyRent}
                placeholder={String(lease?.monthlyRent ?? "")}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">{t("newStartDate")}</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={
                    lease?.endDate
                      ? new Date(new Date(lease.endDate).getTime() + 86400000)
                          .toISOString()
                          .slice(0, 10)
                      : ""
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">{t("newEndDate")}</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  defaultValue={
                    lease?.endDate
                      ? new Date(
                          new Date(new Date(lease.endDate).getTime() + 86400000).setFullYear(
                            new Date(new Date(lease.endDate).getTime() + 86400000).getFullYear() +
                              1,
                          ),
                        )
                          .toISOString()
                          .slice(0, 10)
                      : ""
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t("notesForTenant")}</Label>
              <Textarea id="notes" name="notes" rows={3} placeholder={t("notesPlaceholder")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenewalOpen(false)}>
                {tActions("cancel")}
              </Button>
              <Button type="submit" disabled={renewalSubmitting}>
                {renewalSubmitting ? t("sending") : t("sendRenewal")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
