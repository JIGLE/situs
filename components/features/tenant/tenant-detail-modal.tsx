"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  DollarSign,
  Edit,
  Mail,
  MapPin,
  Phone,
  Trash2,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { tenantSchema, type TenantFormData } from "@/lib/schemas/tenant.schema";
import { getActiveLease } from "@/lib/utils/lease-helpers";
import { TenantRelationshipMap } from "@/components/features/tenant/tenant-relationship-map";

interface TenantDetailModalProps {
  tenantId: string;
  onClose: () => void;
}

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  paid: "bg-[var(--color-success-muted)] text-[var(--color-success)] border-[var(--color-success)]/30",
  pending:
    "bg-[var(--color-warning-muted)] text-[var(--color-warning)] border-[var(--color-warning)]/30",
  overdue:
    "bg-[var(--color-error-muted)] text-[var(--color-destructive)] border-[var(--color-destructive)]/30",
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function TenantDetailModal({ tenantId, onClose }: TenantDetailModalProps) {
  const { formatCurrency } = useCurrency();
  const { updateTenant, deleteTenant, state } = useApp();
  const { properties, leases, receipts } = state;
  const tenant = state.tenants.find((t) => t.id === tenantId) ?? null;
  const { success, error } = useToast();
  const t = useTranslations("tenants");
  const tForms = useTranslations("forms");
  const tActions = useTranslations("actions");
  // `status` already carries paid / pending / overdue in all four catalogues — the chip below was
  // printing the raw enum instead, so an otherwise fully Portuguese modal said "Paid".
  const tStatus = useTranslations("status");
  const confirmDialog = useConfirmDialog();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [formData, setFormData] = useState<TenantFormData>({
    name: "",
    email: "",
    phone: "",
    propertyId: "",
    rent: 0,
    leaseStart: "",
    leaseEnd: "",
    paymentStatus: "pending",
    notes: "",
  });

  useEffect(() => {
    if (tenant) {
      setFormData({
        name: tenant.name || "",
        email: tenant.email || "",
        phone: tenant.phone || "",
        propertyId: tenant.propertyId || "",
        rent: tenant.rent ?? 0,
        leaseStart: tenant.leaseStart || "",
        leaseEnd: tenant.leaseEnd || "",
        paymentStatus: tenant.paymentStatus || "pending",
        notes: tenant.notes || "",
      });
    }
  }, [tenant]);

  if (!tenant) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("modal.notFound")}</p>
      </div>
    );
  }

  const activeLease = getActiveLease(tenant.id, leases);
  const derivedRent = activeLease?.monthlyRent ?? tenant.rent;
  const derivedLeaseStart = activeLease?.startDate ?? tenant.leaseStart;
  const derivedLeaseEnd = activeLease?.endDate ?? tenant.leaseEnd;

  // Derived metrics
  const today = new Date();
  const leaseExpiryDays = derivedLeaseEnd
    ? Math.ceil((new Date(derivedLeaseEnd).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isLeaseExpiringSoon =
    leaseExpiryDays !== null && leaseExpiryDays > 0 && leaseExpiryDays <= 60;
  const isOverdue = tenant.paymentStatus === "overdue";

  // Zone 2: Primary action
  const primaryAction = (() => {
    if (isOverdue) {
      return {
        label: t("modal.recordPayment"),
        onClick: () => {
          onClose();
          router.push(`/financials?tenantId=${tenant.id}`);
        },
        icon: DollarSign,
        variant: "destructive" as const,
      };
    }
    if (isLeaseExpiringSoon && activeLease) {
      return {
        label: t("modal.renewLease"),
        onClick: () => {
          onClose();
          router.push(`/leases?action=renew&id=${activeLease.id}`);
        },
        icon: Calendar,
        variant: "default" as const,
      };
    }
    if (!activeLease) {
      return {
        label: t("modal.addLease"),
        onClick: () => {
          onClose();
          router.push(`/leases?action=create&tenantId=${tenant.id}`);
        },
        icon: Wrench,
        variant: "default" as const,
      };
    }
    return null;
  })();

  // Zone 3: Issues
  const issues = [];
  if (!activeLease) {
    issues.push({
      id: "no-lease",
      icon: AlertTriangle,
      color: "text-[var(--color-warning)]",
      label: t("modal.noActiveLease"),
    });
  }
  if (!tenant.email) {
    issues.push({
      id: "no-email",
      icon: Mail,
      color: "text-[var(--color-warning)]",
      label: t("modal.noEmail"),
    });
  }
  if (isOverdue) {
    issues.push({
      id: "overdue",
      icon: AlertTriangle,
      color: "text-[var(--color-destructive)]",
      label: t("modal.paymentOverdue"),
    });
  }

  // Payments tab: last 3 receipts for this tenant
  const tenantReceipts = [...(receipts ?? [])]
    .filter((r) => r.tenantId === tenant.id)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  function handleCancel() {
    if (tenant) {
      setFormData({
        name: tenant.name || "",
        email: tenant.email || "",
        phone: tenant.phone || "",
        propertyId: tenant.propertyId || "",
        rent: tenant.rent ?? 0,
        leaseStart: tenant.leaseStart || "",
        leaseEnd: tenant.leaseEnd || "",
        paymentStatus: tenant.paymentStatus || "pending",
        notes: tenant.notes || "",
      });
    }
    setIsEditing(false);
  }

  async function handleSave() {
    try {
      const data = tenantSchema.parse(formData);
      await updateTenant(tenant!.id, data);
      success?.("Tenant updated");
      setIsEditing(false);
    } catch {
      error?.("Failed to save tenant");
    }
  }

  function handleDelete() {
    confirmDialog.confirm(
      {
        title: t("deleteOne.title"),
        description: `"${tenant!.name}" will be permanently removed. This action cannot be undone.`,
        confirmLabel: t("deleteOne.confirmLabel"),
        variant: "destructive",
      },
      async () => {
        try {
          await deleteTenant(tenant!.id);
          success?.("Tenant deleted");
          onClose();
        } catch {
          error?.("Failed to delete tenant");
        }
      },
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* ── Zone 1: Header + Status ─────────────────────────────────── */}
        <div className="flex flex-col space-y-2 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-primary/20 ring-1 ring-accent-primary/30">
                <span className="text-sm font-semibold text-accent-primary">
                  {tenant.name
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-none tracking-tight text-[var(--color-foreground)] truncate">
                  {isEditing ? "Edit Tenant" : tenant.name}
                </h2>
                <div className="flex items-center gap-2 mt-0.5 text-sm text-[var(--color-muted-foreground)]">
                  <span className="flex items-center gap-1 text-xs">
                    <Mail className="h-3 w-3" />
                    {tenant.email || "No email"}
                  </span>
                </div>
              </div>
            </div>
            {!isEditing && (
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_STYLES[tenant.paymentStatus] ?? ""}`}
                >
                  {tStatus(tenant.paymentStatus)}
                </span>
                {isLeaseExpiringSoon && leaseExpiryDays !== null && (
                  <span className="inline-flex items-center rounded-full border border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-warning)]">
                    {t("leaseExpiresInDays", { days: leaseExpiryDays })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {isEditing ? (
          /* ── Edit Mode ──────────────────────────────────────────────── */
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{tForms("fullName")}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Doctrine rule 6: a multi-column form is single-column below `md`. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">{tForms("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{tForms("phone")}</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="property">{tForms("property")}</Label>
              <Select
                value={formData.propertyId}
                onValueChange={(value) => setFormData({ ...formData, propertyId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tForms("selectProperty")} />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name} - {property.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("paymentStatus")}</Label>
              <p className="text-sm text-muted-foreground">{t("modal.derivedFromMatrix")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">{tForms("notes")}</Label>
              <Textarea
                id="notes"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleCancel}>
                {tActions("cancel")}
              </Button>
              <Button onClick={handleSave}>{tActions("save")}</Button>
            </div>
          </div>
        ) : (
          /* ── View Mode ──────────────────────────────────────────────── */
          <div className="space-y-4">
            {/* ── Zone 2: Primary Action ─────────────────────────────── */}
            {primaryAction && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {isOverdue && "This tenant has an overdue payment. Record it now."}
                    {isLeaseExpiringSoon &&
                      !isOverdue &&
                      `Lease expires in ${leaseExpiryDays} days. Renew before it lapses.`}
                    {!activeLease &&
                      !isOverdue &&
                      "No active lease found. Create one to track rent."}
                  </p>
                  <Button
                    size="sm"
                    variant={primaryAction.variant}
                    onClick={primaryAction.onClick}
                    className="shrink-0"
                  >
                    <primaryAction.icon className="h-3.5 w-3.5 mr-1.5" />
                    {primaryAction.label}
                  </Button>
                </div>
              </div>
            )}

            {/* ── Zone 3: Issues ─────────────────────────────────────── */}
            {issues.length > 0 && (
              <div className="space-y-2">
                {issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm"
                  >
                    <issue.icon className={`h-3.5 w-3.5 shrink-0 ${issue.color}`} />
                    <span className="text-[var(--color-foreground)]">{issue.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Zone 4: Tabbed Info ─────────────────────────────────── */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start">
                <TabsTrigger value="overview">{t("modal.tabOverview")}</TabsTrigger>
                <TabsTrigger value="lease">{t("modal.tabLease")}</TabsTrigger>
                <TabsTrigger value="payments">{t("modal.tabPayments")}</TabsTrigger>
                <TabsTrigger value="activity">{t("modal.tabActivity")}</TabsTrigger>
              </TabsList>

              {/* Overview tab */}
              <TabsContent value="overview" className="space-y-3 mt-4">
                {/* One column below `sm`. Two cards across a 390px phone left about 180px each,
                    which clipped `joao.silva@outlook.pt` by 16px with only a `title` tooltip to
                    recover it — and a phone has no hover. */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                    <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide mb-2">
                      {t("modal.contact")}
                    </p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                        <span className="break-words" title={tenant.email || undefined}>
                          {tenant.email || "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                        <span>{tenant.phone || "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                    <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide mb-2">
                      {tForms("property")}
                    </p>
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] mt-0.5" />
                      <span className="font-medium">{tenant.propertyName || "Unassigned"}</span>
                    </div>
                  </div>
                </div>
                {tenant.notes && (
                  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                    <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide mb-1">
                      {tForms("notes")}
                    </p>
                    <p className="text-sm text-[var(--color-foreground)]">{tenant.notes}</p>
                  </div>
                )}
              </TabsContent>

              {/* Lease tab */}
              <TabsContent value="lease" className="mt-4">
                {activeLease ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-[var(--color-foreground)]">
                          {t("modal.activeLease")}
                        </p>
                        {leaseExpiryDays !== null && (
                          <Badge
                            variant="outline"
                            className={
                              leaseExpiryDays <= 30
                                ? "border-[var(--color-destructive)]/30 bg-[var(--color-error-muted)] text-[var(--color-destructive)]"
                                : leaseExpiryDays <= 60
                                  ? "border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)] text-[var(--color-warning)]"
                                  : "border-[var(--color-success)]/30 bg-[var(--color-success-muted)] text-[var(--color-success)]"
                            }
                          >
                            {leaseExpiryDays > 0 ? `${leaseExpiryDays} days left` : "Expired"}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
                            {t("monthlyRent")}
                          </p>
                          <p className="mt-0.5 font-semibold text-[var(--color-foreground)]">
                            {formatCurrency(derivedRent)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
                            {tForms("status")}
                          </p>
                          <p className="mt-0.5 capitalize font-medium text-[var(--color-foreground)]">
                            {activeLease.status}
                          </p>
                        </div>
                        <div>
                          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
                            {tForms("leaseStart")}
                          </p>
                          <p className="mt-0.5 text-[var(--color-foreground)]">
                            {formatDate(derivedLeaseStart)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[12px] md:text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
                            {tForms("leaseEnd")}
                          </p>
                          <p className="mt-0.5 text-[var(--color-foreground)]">
                            {formatDate(derivedLeaseEnd)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center">
                    <Calendar className="mx-auto h-8 w-8 text-[var(--color-muted-foreground)] mb-2 opacity-50" />
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {t("modal.noActiveLease")}
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* Payments tab */}
              <TabsContent value="payments" className="mt-4">
                {tenantReceipts.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center">
                    <DollarSign className="mx-auto h-8 w-8 text-[var(--color-muted-foreground)] mb-2 opacity-50" />
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      {t("modal.noPayments")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tenantReceipts.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-medium text-[var(--color-foreground)]">
                            {r.description || r.type}
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {formatDate(r.date)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {r.status === "paid" ? (
                            <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
                          )}
                          <span className="text-sm font-semibold text-[var(--color-foreground)]">
                            {formatCurrency(r.amount)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Activity tab — relationship-map strip */}
              <TabsContent value="activity" className="mt-4">
                <TenantRelationshipMap tenantId={tenant.id} />
              </TabsContent>
            </Tabs>

            {/* Action Buttons */}
            <div className="flex justify-between gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="gap-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {tActions("delete")}
              </Button>
              <Button
                size="sm"
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5"
              >
                <Edit className="w-3.5 h-3.5" />
                {t("modal.editTenant")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}
