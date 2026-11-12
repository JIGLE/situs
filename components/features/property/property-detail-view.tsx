"use client";

import { useState, useMemo, useRef } from "react";
import {
  Building2,
  MapPin,
  Bed,
  Bath,
  ArrowLeft,
  Users,
  FileText,
  Wrench,
  DollarSign,
  Receipt,
  Plus,
  Trash2,
  History,
  Pencil,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useApiError } from "@/lib/utils/api-error";
import { cn } from "@/lib/utils/utils";
import { apiFetch } from "@/lib/utils/api-client";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Tabs, TabsContent, TabsList, TabsMobileSelect, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useTabPersistence } from "@/lib/hooks/use-tab-persistence";
import { EntityLink } from "@/components/shared/entity-link";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { usePropertyActivity } from "@/lib/hooks/use-property-activity";
import { AuditTrail } from "@/components/shared/audit-trail";
import { TenancySheet } from "@/components/features/lease/tenancy-sheet";
import { ExpenseDialog, useExpenseDialog } from "@/components/features/financial/expense-dialog";
import {
  RecordPaymentDialog,
  type RecordPaymentPreset,
} from "@/components/features/financial/record-payment-dialog";
import { PropertyFormDialog, type PropertyFormDialogRef } from "./property-form-dialog";
import { PropertyYearStrip, type YearStripSelection } from "./property-year-strip";
import { expenseCategoryKey } from "@/lib/utils/expense-labels";
import { rentPeriodStatusKey } from "@/lib/utils/rent-period-labels";
import { joinContact } from "@/lib/utils/contact";
import { formatMonthYear } from "@/lib/utils/format-date";
import { StatusMark } from "@/components/ui/status-mark";
import { propertyStatus } from "@/lib/utils/status-tone";
import { incomeTotal } from "@/lib/utils/receipt-income";

interface PropertyDetailViewProps {
  propertyId: string;
}

export function PropertyDetailView({ propertyId }: PropertyDetailViewProps) {
  const { state, refreshData, deleteProperty } = useApp();
  const { success } = useToast();
  const confirmDialog = useConfirmDialog();
  const { formatCurrency } = useCurrency();
  const router = useRouter();
  const locale = useLocale();
  const [activeTab, setActiveTab] = useTabPersistence("property-detail", "overview");
  const t = useTranslations("propertyDetail");
  const tFin = useTranslations("financial");
  const tTypes = useTranslations("properties.types");
  const tPeriod = useTranslations("rentPeriodStatus");
  const tStatus = useTranslations("status");
  const tLeases = useTranslations("leases");
  const periodLabel = (status?: string | null) => {
    const key = rentPeriodStatusKey(status);
    return key ? tPeriod(key) : status || "—";
  };
  const apiError = useApiError();

  /**
   * Expense categories are stored as human labels ("Mortgage Interest") while the catalog keys
   * them snake_case ("mortgage_interest"), so a direct `tFin("categories." + raw)` always
   * missed — and next-intl renders the key path rather than returning undefined, so a `||`
   * fallback never fired and the UI showed "financial.categories.Mortgage Interest". Normalise
   * the key, and fall back to the stored label when there is genuinely no translation.
   */
  /** Lease dates arrive as full ISO timestamps; rendered raw they wrap a card into three lines. */
  const formatDay = (raw: string): string => {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime())
      ? raw
      : parsed.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  };

  const expenseCategoryLabel = (raw?: string | null): string => {
    if (!raw) return tFin("expense");
    // Asked only for a category the catalogue has. This used to ask for any key and spot a miss
    // by the key path next-intl renders for one, which also logged an error each time.
    const key = expenseCategoryKey(raw);
    return key ? tFin(`categories.${key}`) : raw;
  };
  // (no debug logs in production view)

  // Ownership assignment state
  const { token: csrfToken } = useCsrf();
  const [ownerAssignOwnerId, setOwnerAssignOwnerId] = useState("");
  const [ownerAssignPct, setOwnerAssignPct] = useState<number | "">("");
  const [ownerAssignError, setOwnerAssignError] = useState("");
  const [ownerAssignSaving, setOwnerAssignSaving] = useState(false);

  // The reference month whose detail modal is open, set by clicking a year-strip cell.
  const [selectedMonth, setSelectedMonth] = useState<YearStripSelection | null>(null);

  // Quick-add, with this property filled in: the same expense form as Finance › Expenses, and
  // the same Record payment as Finance and the rent matrix. This page used to carry its own copy
  // of each, and its payment form asked for a tenant rather than a lease.
  const expenseDialog = useExpenseDialog(propertyId);
  const [paymentPreset, setPaymentPreset] = useState<RecordPaymentPreset | null>(null);

  // New tenancy, in place: the property is filled in. This was an "Add tenant" dialog that
  // created a person and no lease, so the property stayed vacant and nothing was ever due.
  const [tenancyOpen, setTenancyOpen] = useState(false);

  // Edit property: own instance of the same form/schema/updateProperty path
  // PropertiesView uses for create — see property-form-dialog.tsx.
  const editFormDialogRef = useRef<PropertyFormDialogRef>(null);

  const property = state.properties.find((p) => p.id === propertyId);
  const { data: activity, loading: activityLoading } = usePropertyActivity(propertyId);

  // Related entities
  const relatedTenants = useMemo(
    () => state.tenants.filter((t) => t.propertyId === propertyId),
    [state.tenants, propertyId],
  );
  const relatedLeases = useMemo(
    () => state.leases.filter((l) => l.propertyId === propertyId),
    [state.leases, propertyId],
  );
  const relatedReceipts = useMemo(
    () => state.receipts.filter((r) => r.propertyId === propertyId),
    [state.receipts, propertyId],
  );
  const relatedExpenses = useMemo(
    () => state.expenses.filter((e) => e.propertyId === propertyId),
    [state.expenses, propertyId],
  );

  // AuditLog rows key off resourceId=receipt/lease/tenant/property id (Migration A) —
  // scope the Audit tab to everything already loaded for this property, no extra fetch.
  const auditResourceIds = useMemo(
    () => [
      propertyId,
      ...relatedTenants.map((t) => t.id),
      ...relatedLeases.map((l) => l.id),
      ...relatedReceipts.map((r) => r.id),
      ...relatedExpenses.map((e) => e.id),
    ],
    [propertyId, relatedTenants, relatedLeases, relatedReceipts, relatedExpenses],
  );

  const totalRevenue = incomeTotal(relatedReceipts);
  const totalExpenses = relatedExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netOperatingIncome = totalRevenue - totalExpenses;
  const activeLeasesList = relatedLeases.filter((l) => l.status === "active");

  // Ownership: derive from owners state
  const propertyOwners = useMemo(
    () =>
      state.owners
        .filter((o) => o.properties?.some((po) => po.propertyId === propertyId))
        .map((o) => ({
          owner: o,
          assignment: o.properties!.find((po) => po.propertyId === propertyId)!,
        })),
    [state.owners, propertyId],
  );
  const ownershipTotal = propertyOwners.reduce(
    (s, { assignment }) => s + assignment.ownershipPercentage,
    0,
  );
  const unassignedOwners = state.owners.filter(
    (o) => !o.properties?.some((po) => po.propertyId === propertyId),
  );

  const handleAssignOwner = async () => {
    if (!ownerAssignOwnerId || ownerAssignPct === "") {
      setOwnerAssignError("Select an owner and enter a percentage.");
      return;
    }
    const pct = Number(ownerAssignPct);
    if (pct <= 0 || pct > 100) {
      setOwnerAssignError("Percentage must be between 1 and 100.");
      return;
    }
    if (ownershipTotal + pct > 100.001) {
      setOwnerAssignError(`Total would exceed 100% (current: ${ownershipTotal.toFixed(1)}%).`);
      return;
    }
    setOwnerAssignError("");
    setOwnerAssignSaving(true);
    try {
      await apiFetch("/api/property-owners", csrfToken, "POST", {
        propertyId,
        ownerId: ownerAssignOwnerId,
        ownershipPercentage: pct,
      });
      setOwnerAssignOwnerId("");
      setOwnerAssignPct("");
      await refreshData();
    } catch (err) {
      setOwnerAssignError(apiError(err));
    } finally {
      setOwnerAssignSaving(false);
    }
  };

  const handleRemoveOwner = async (ownerId: string) => {
    setOwnerAssignError("");
    try {
      await apiFetch(
        `/api/property-owners?propertyId=${propertyId}&ownerId=${ownerId}`,
        csrfToken,
        "DELETE",
      );
      await refreshData();
    } catch (err) {
      // Previously swallowed every error ("silently fail in demo mode"), which is why a failed
      // removal looked like it had worked. Surface it in the same place as the assign error.
      setOwnerAssignError(apiError(err));
    }
  };

  // Collection rate: percentage of expected rent actually received
  const collectionMetrics = useMemo(() => {
    const totalExpectedRent = activeLeasesList.reduce((sum, l) => {
      const start = new Date(l.startDate);
      const end = new Date(l.endDate);
      const now = new Date();
      const effectiveEnd = end < now ? end : now;
      // Count months the lease has been active
      const months =
        (effectiveEnd.getFullYear() - start.getFullYear()) * 12 +
        (effectiveEnd.getMonth() - start.getMonth()) +
        1;
      return sum + l.monthlyRent * Math.max(months, 0);
    }, 0);
    const paidReceipts = incomeTotal(relatedReceipts);
    const collectionRate = totalExpectedRent > 0 ? (paidReceipts / totalExpectedRent) * 100 : 0;
    return { totalExpectedRent, paidReceipts, collectionRate };
  }, [activeLeasesList, relatedReceipts]);

  if (!property) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-[var(--color-muted-foreground)]">{t("notFound")}</p>
        <Button variant="outline" onClick={() => router.push("/portfolio")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("actions.backToProperties")}
        </Button>
      </div>
    );
  }

  return (
    // `@container`: this view renders at two very different widths — inside the portfolio
    // workspace (~1100px on a 1440px window, narrower still while the rail was docked) and as a
    // full-width page at /portfolio/[id]. Viewport breakpoints cannot tell those apart, so a
    // wide window with a narrow workspace still fired `lg:` and laid out three columns in a
    // space that could not hold them. Every layout breakpoint below is a container query, so
    // the detail responds to the room it actually has.
    <div className="@container space-y-6">
      {/* Edit property — own instance of the shared create/edit form */}
      <PropertyFormDialog ref={editFormDialogRef} />
      <ConfirmationDialog dialog={confirmDialog} />

      {/* Header */}
      <div className="flex flex-col gap-4 sticky top-0 z-20 bg-[var(--color-card-solid)]">
        <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start @lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 lg:p-4 bg-[var(--color-info-muted)]">
              <Building2 className="h-8 w-8 lg:h-10 lg:w-10 text-[var(--color-info)]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-foreground)]">
                {property.name}
              </h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-[var(--color-muted-foreground)]">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{property.address}</span>
              </div>
              {/* Wraps: at 360px the status, rooms and rent ran 14px past the screen edge. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusMark {...propertyStatus(property.status)}>
                  {t(`status.${property.status}`) || property.status}
                </StatusMark>
                {/* Unknown is null, and shows nothing: a bare icon would read as none. */}
                {property.bedrooms != null && (
                  <span className="text-sm text-[var(--color-muted-foreground)] flex items-center gap-1">
                    <Bed className="h-3.5 w-3.5" /> {property.bedrooms}
                  </span>
                )}
                {property.bathrooms != null && (
                  <span className="text-sm text-[var(--color-muted-foreground)] flex items-center gap-1">
                    <Bath className="h-3.5 w-3.5" /> {property.bathrooms}
                  </span>
                )}
                <span className="text-sm font-medium">
                  {tLeases("perMonth", { amount: formatCurrency(property.rent) })}
                </span>
              </div>
            </div>
          </div>
          {/* The header's five-button quick-action bar has gone. Each action now lives where
              its subject does: Edit with the property's own details (Overview), Add Expense in
              Money, Documents as its own tab, and Record Payment behind a click on the reference
              month it applies to. */}
        </div>
      </div>

      {/* Year-at-a-glance rent ledger — the money state leads the workspace
          (Situs reference-month ledger / RentPeriod). Replaces the old
          text-only Current Period band with a 12-month visual history. */}
      {!activityLoading && activity?.yearStrip && (
        <PropertyYearStrip
          propertyId={propertyId}
          defaultYearStrip={activity.yearStrip}
          currentPeriod={activity.currentPeriod}
          receiptLifecycle={activity.receiptLifecycle}
          onSelectMonth={setSelectedMonth}
        />
      )}

      <TenancySheet open={tenancyOpen} onOpenChange={setTenancyOpen} prefill={{ propertyId }} />
      <ExpenseDialog dialog={expenseDialog} propertyName={property.name} />
      <RecordPaymentDialog
        open={paymentPreset !== null}
        onOpenChange={(open) => !open && setPaymentPreset(null)}
        preset={paymentPreset ?? undefined}
        onRecorded={() => void refreshData()}
      />

      {/* Reference-month detail. Record Payment used to be a header button divorced from the
          month it applied to; it now opens from the month itself, with the ledger figures for
          that period alongside it. */}
      <Dialog
        open={selectedMonth !== null}
        onOpenChange={(open) => !open && setSelectedMonth(null)}
      >
        <DialogContent className="sm:max-w-[440px]">
          {selectedMonth && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedMonth.label} {selectedMonth.year}
                </DialogTitle>
                <DialogDescription>
                  {t("month.subtitle", { property: property.name })}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-3 gap-3">
                  <div className="panel p-3">
                    <p className="mono-label">{t("month.status")}</p>
                    {/* `replace(/_/g, " ")` plus `capitalize` is not a translation: it turned
                        `partially_paid` into "Partially paid" and showed that inside a
                        Portuguese ledger. The seven `RentPeriod` states now come from
                        `rentPeriodStatus`. */}
                    <p className="mt-1 text-sm font-medium text-[var(--color-foreground)]">
                      {periodLabel(selectedMonth.status)}
                    </p>
                  </div>
                  <div className="panel p-3">
                    <p className="mono-label">{t("month.due")}</p>
                    <p className="mt-1 text-sm font-light tabular-nums text-[var(--color-foreground)]">
                      {formatCurrency(selectedMonth.dueAmount)}
                    </p>
                  </div>
                  <div className="panel p-3">
                    <p className="mono-label">{t("month.allocated")}</p>
                    <p className="mt-1 text-sm font-light tabular-nums text-[var(--color-success)]">
                      {formatCurrency(selectedMonth.allocatedAmount)}
                    </p>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={() => {
                    setSelectedMonth(null);
                    setPaymentPreset({
                      propertyId,
                      // The month's lease, when the property has one: the payment is for it.
                      leaseId: activeLeasesList.length === 1 ? activeLeasesList[0].id : undefined,
                      amount:
                        Math.max(selectedMonth.dueAmount - selectedMonth.allocatedAmount, 0) ||
                        undefined,
                    });
                  }}
                >
                  <Receipt className="mr-1.5 h-4 w-4" />
                  {t("actions.recordPayment")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* The four-card stat row that used to sit here has gone. Every number on it was already
          on screen: tenants and active leases are listed in People & Contracts below, and
          revenue now badges the Money tab. Density rules 2 and 4 in CLAUDE.md — one stat row,
          and counts as text before counts as boxes. */}

      {/* Tabs. The bar overflowed its container by 207px at 390px when it carried five
          triggers, so Documents and Audit were reachable only by discovering a horizontal
          scroll — doctrine rule 4 swaps the bar for a select below `md`. The Operations
          trigger has since gone with the ticketing cut; the select stays, because rule 4 is a
          space test in the longest locale and not a count. Badge counts ride along as
          `Label (3)` so the mobile view states what the bar states. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsMobileSelect
          className="md:hidden"
          value={activeTab}
          onValueChange={setActiveTab}
          aria-label={t("tabs.overview")}
          items={[
            { value: "overview", label: t("tabs.overview") },
            {
              value: "finance",
              label: t("tabs.money"),
              badge: totalRevenue > 0 ? formatCurrency(totalRevenue) : undefined,
            },
            { value: "audit", label: t("tabs.audit") },
          ]}
        />
        <TabsList className="overflow-x-auto max-md:hidden">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="finance" className="flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5" />
            {t("tabs.money")}
            {totalRevenue > 0 && (
              <span className="ml-1 bg-[var(--color-popover)] px-1.5 py-0.5 font-mono text-label tabular-nums text-[var(--color-muted-foreground)]">
                {formatCurrency(totalRevenue)}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            {t("tabs.audit")}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-5">
          {/* Spec band, not a card. Monthly rent, bedrooms and bathrooms are already in the
              identity row a few hundred pixels above (`Occupied · 2 · 1 · €1,500/mo`), so all
              that is genuinely unique here is the type and the description — one or two fields,
              which is far too little to justify two thirds of the row. As a card it left People
              & contracts squeezed into the remaining third, wrapping every lease over three
              lines. Demoted to a single quiet row so the two real sections below can split the
              width evenly. */}
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-[var(--color-border)] pb-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <div className="flex items-baseline gap-2">
                  <dt className="mono-label">{t("type")}</dt>
                  <dd className="text-sm font-medium">{tTypes(property.type)}</dd>
                </div>
                {property.city && (
                  <div className="flex items-baseline gap-2">
                    <dt className="mono-label">{t("city")}</dt>
                    <dd className="text-sm font-medium">{property.city}</dd>
                  </div>
                )}
              </dl>
              {property.description && (
                <p className="max-w-[72ch] text-sm text-[var(--color-muted-foreground)]">
                  {property.description}
                </p>
              )}
            </div>
            {/* Edit sits with the fields it edits rather than in a global action bar. Delete beside
                it is for a property added by mistake: one with leases, receipts or expenses is
                refused by the server, and the toast says why. */}
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => editFormDialogRef.current?.openEditDialog(property)}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                {t("actions.edit")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={t("actions.delete")}
                onClick={() =>
                  confirmDialog.confirm(
                    {
                      title: t("deleteOne.title"),
                      description: t("deleteOne.description", { name: property.name }),
                      confirmLabel: t("deleteOne.confirmLabel"),
                      variant: "destructive",
                    },
                    async () => {
                      try {
                        await deleteProperty(property.id);
                      } catch {
                        return; // Refused (it has history) or failed: the toast already says why.
                      }
                      success(t("deleteOne.done", { name: property.name }));
                      router.push("/portfolio");
                    },
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Splits at @xl (36rem) rather than @2xl: the workspace container is ~644px at a
              1280px window, so a 42rem threshold left the pair stacked on the most common
              laptop width — the exact case this layout exists to fix. */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 @xl:grid-cols-2">
            {/* People & contracts — folds the former standalone Tenants and
                Leases tabs in here (Overview absorbs them per the tab merge). */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)]">
                  {t("related")}
                </h3>
                {/* Opens in place, with this property filled in: the tenant and the lease are
                    made together. Tenants below open the shared `?detail=tenant:<id>` overlay on
                    click (EntityLink), which is the edit path. */}
                <Button size="sm" variant="outline" onClick={() => setTenancyOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {tLeases("sheet.title")}
                </Button>
              </div>
              {relatedTenants.map((tenant) => (
                <EntityLink
                  key={tenant.id}
                  type="tenant"
                  id={tenant.id}
                  title={tenant.name}
                  subtitle={joinContact(tenant.email, tenant.phone) || undefined}
                  status={tStatus(tenant.paymentStatus)}
                  statusVariant={
                    tenant.paymentStatus === "paid"
                      ? "success"
                      : tenant.paymentStatus === "overdue"
                        ? "destructive"
                        : "warning"
                  }
                  variant="full"
                />
              ))}
              {relatedLeases.map((lease) => {
                const daysUntilExpiry = Math.ceil(
                  (new Date(lease.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                );
                const isExpiring =
                  lease.status === "active" && daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
                return (
                  <div key={lease.id} className="space-y-1">
                    <EntityLink
                      type="lease"
                      id={lease.id}
                      title={tLeases("perMonth", { amount: formatCurrency(lease.monthlyRent) })}
                      subtitle={`${formatDay(lease.startDate)} — ${formatDay(lease.endDate)}`}
                      status={tLeases(lease.status)}
                      statusVariant={
                        lease.status === "active"
                          ? "success"
                          : lease.status === "expired"
                            ? "destructive"
                            : "warning"
                      }
                      variant="full"
                    />
                    {isExpiring && (
                      <div className="flex items-center justify-between border border-[var(--color-warning)]/20 bg-[var(--color-warning-muted)] px-3 py-1.5">
                        <span className="text-xs text-[var(--color-warning)]">
                          {t("expiresIn", { days: daysUntilExpiry })}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-2 text-xs text-[var(--color-warning)] hover:bg-[var(--color-warning-muted)] hover:text-[var(--color-warning)]"
                          onClick={() =>
                            router.push(`/portfolio?tab=leases&action=renew&id=${lease.id}`)
                          }
                        >
                          {t("renew")}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {relatedTenants.length === 0 && relatedLeases.length === 0 && (
                <div className="border border-dashed border-[var(--color-border)] p-4 text-center space-y-2">
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {property.status === "vacant" ? t("vacantNotice") : t("noRelatedEntities")}
                  </p>
                  {property.status === "vacant" && (
                    <Button size="sm" variant="outline" onClick={() => setTenancyOpen(true)}>
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      {tLeases("sheet.title")}
                    </Button>
                  )}
                </div>
              )}
            </section>

            {/* Ownership & revenue share — the other half of the row, same section shape as its
                neighbour so the two read as a pair rather than a card stacked under a card. */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-muted-foreground)]">
                  <Users className="h-4 w-4" />
                  {t("ownership.title")}
                </h3>
                <StatusMark
                  tone={
                    Math.abs(ownershipTotal - 100) < 0.01
                      ? "success"
                      : ownershipTotal > 0
                        ? "warning"
                        : "neutral"
                  }
                >
                  {t("ownership.assigned", { percent: ownershipTotal.toFixed(1) })}
                </StatusMark>
              </div>
              {propertyOwners.length === 0 ? (
                <p className="text-sm italic text-[var(--color-muted-foreground)]">
                  {t("ownership.none")}
                </p>
              ) : (
                <div className="space-y-2">
                  {propertyOwners.map(({ owner, assignment }) => {
                    const ownerIncome =
                      incomeTotal(relatedReceipts) * (assignment.ownershipPercentage / 100);
                    return (
                      <div
                        key={owner.id}
                        className="flex items-center gap-3 p-2 bg-[var(--color-card-solid)] border border-[var(--color-border)]"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                            {owner.name}
                          </p>
                          {owner.email && (
                            <p className="text-xs text-[var(--color-muted-foreground)]">
                              {owner.email}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-[var(--color-foreground)]">
                            {assignment.ownershipPercentage}%
                          </p>
                          <p className="text-xs text-[var(--color-success)]">
                            {formatCurrency(ownerIncome)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]"
                          onClick={() => handleRemoveOwner(owner.id)}
                          title={t("ownership.remove")}
                          aria-label={t("ownership.remove")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add owner form */}
              {unassignedOwners.length > 0 && ownershipTotal < 99.999 && (
                <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                  <p className="mono-label">{t("ownership.assign")}</p>
                  <div className="flex gap-2">
                    <Select value={ownerAssignOwnerId} onValueChange={setOwnerAssignOwnerId}>
                      <SelectTrigger className="flex-1 text-sm">
                        <SelectValue placeholder={t("ownership.selectOwner")} />
                      </SelectTrigger>
                      <SelectContent>
                        {unassignedOwners.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      max={100 - ownershipTotal}
                      step={0.1}
                      placeholder="%"
                      value={ownerAssignPct}
                      onChange={(e) =>
                        setOwnerAssignPct(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className="w-20 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleAssignOwner}
                      disabled={ownerAssignSaving}
                      className="shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {ownerAssignError && (
                    <p className="text-xs text-[var(--color-destructive)]">{ownerAssignError}</p>
                  )}
                  {Math.abs(ownershipTotal + Number(ownerAssignPct || 0) - 100) < 0.01 && (
                    <p className="text-xs text-[var(--color-success)]">
                      {t("ownership.reachesFull")}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        </TabsContent>

        {/* Money Tab — Payments/P&L merged with the former standalone Expenses
            tab, per the tab merge (Overview/Money/Audit). */}
        <TabsContent value="finance" className="space-y-6">
          {/* Money-tab actions: the expense dialog opens from here, where expenses live. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={expenseDialog.openDialog}>
              <Wrench className="mr-1.5 h-3.5 w-3.5" />
              {t("actions.addExpense")}
            </Button>
          </div>

          {/* P&L row — the same `panel` + mono-label + light tabular treatment the rest of the
              app uses. These were four bordered Cards at text-2xl/bold, which shouted louder
              than the transactions they summarise. */}
          <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <div className="panel p-3">
              <p className="mono-label">{t("finance.totalRevenue")}</p>
              <p className="mt-1 text-lg font-light tabular-nums text-[var(--color-success)]">
                {formatCurrency(totalRevenue)}
              </p>
            </div>
            <div className="panel p-3">
              <p className="mono-label">{t("finance.totalExpenses")}</p>
              <p className="mt-1 text-lg font-light tabular-nums text-[var(--color-destructive)]">
                {formatCurrency(totalExpenses)}
              </p>
            </div>
            <div className="panel p-3">
              <p className="mono-label">{t("finance.netOperatingIncome")}</p>
              <p
                className={cn(
                  "mt-1 text-lg font-light tabular-nums",
                  netOperatingIncome >= 0
                    ? "text-[var(--color-success)]"
                    : "text-[var(--color-destructive)]",
                )}
              >
                {formatCurrency(netOperatingIncome)}
              </p>
            </div>
            <div className="panel p-3">
              <p className="mono-label">{t("finance.collectionRate")}</p>
              <p
                className={cn(
                  "mt-1 text-lg font-light tabular-nums",
                  collectionMetrics.collectionRate >= 90
                    ? "text-[var(--color-success)]"
                    : collectionMetrics.collectionRate >= 70
                      ? "text-[var(--color-warning)]"
                      : "text-[var(--color-destructive)]",
                )}
              >
                {collectionMetrics.collectionRate.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* The standalone Expenses list that used to sit here is gone: every row it rendered
              also appears in Recent transactions below, so each expense was on screen twice,
              and its header repeated the totalExpenses figure already in the P&L row above.
              Transactions now carry the expense description so no detail was lost with it. */}

          {relatedReceipts.length === 0 && relatedExpenses.length === 0 ? (
            <EmptyStateIllustration entityType="receipts" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{tFin("recentTransactions")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    ...relatedReceipts.map((r) => ({ ...r, txType: "receipt" as const })),
                    ...relatedExpenses.map((e) => ({ ...e, txType: "expense" as const })),
                  ]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .slice(0, 10)
                    .map((tx) => (
                      // An expense opens in its form, to change or delete it; a payment has
                      // its own screens.
                      <div
                        key={tx.id}
                        {...(tx.txType === "expense"
                          ? {
                              role: "button",
                              tabIndex: 0,
                              onClick: () => expenseDialog.openExpense(tx),
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  expenseDialog.openExpense(tx);
                                }
                              },
                            }
                          : {})}
                        className={cn(
                          "flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0",
                          tx.txType === "expense" &&
                            "min-h-11 cursor-pointer hover:bg-[var(--color-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none",
                        )}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {tx.txType === "receipt"
                              ? tFin("paymentReceived")
                              : expenseCategoryLabel(tx.category)}
                          </p>
                          {tx.txType === "expense" && tx.description && (
                            <p className="text-xs text-[var(--color-muted-foreground)]">
                              {tx.description}
                            </p>
                          )}
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {new Date(tx.date).toLocaleDateString(locale)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            tx.txType === "receipt"
                              ? "text-[var(--color-success)]"
                              : "text-[var(--color-destructive)]",
                          )}
                        >
                          {tx.txType === "receipt" ? "+" : "-"}
                          {formatCurrency(tx.amount)}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* PaymentTimeline — reference-month allocation events for this property's ledger */}
          {activity && activity.timeline.length > 0 && (
            <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="border-b border-[var(--color-border)] px-4 py-3">
                <p className="mono-label">{t("paymentTimeline")}</p>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {activity.timeline.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 bg-[var(--ui-accent)]" />
                      <span>
                        {entry.reversedAt ? t("timelineReversed") : t("month.allocated")} ·{" "}
                        {formatMonthYear(entry.period.year, entry.period.month, locale)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "tabular-nums",
                        entry.reversedAt
                          ? "text-[var(--color-muted-foreground)] line-through"
                          : "text-[var(--color-foreground)]",
                      )}
                    >
                      {formatCurrency(entry.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Audit Tab — the shared AuditTrail component (GET /api/audit-trail), scoped to
            this property plus its tenants/leases/receipts/expenses (Migration A resourceId keys). */}
        <TabsContent value="audit">
          <AuditTrail
            resourceIds={auditResourceIds}
            emptyDescription="A full activity history for this property — payment allocations, receipt emissions, document changes and manual overrides — will appear here."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
