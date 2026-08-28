"use client";

import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Mail, Plus, MoreHorizontal, Trash2, Edit, Eye, ChevronDown } from "lucide-react";
import { SortableHeader } from "@/components/ui/sortable-header";
import { DataViewToggle, DataViewMode } from "@/components/ui/data-view-toggle";
import { RenderTable } from "@/components/ui/table";
import { useCurrency } from "@/lib/contexts/currency-context";
import { cn } from "@/lib/utils/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchFilter } from "@/components/ui/search-filter";
import { BulkActionBar, getDefaultBulkActions } from "@/components/ui/bulk-action-bar";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";

import { Checkbox } from "@/components/ui/checkbox";
import { useApp } from "@/lib/contexts/app-context";

import { Tenant } from "@/lib/types";
import { getActiveLease } from "@/lib/utils/lease-helpers";
import { tenantSchema, type TenantFormData } from "@/lib/schemas/tenant.schema";
import { useToast } from "@/lib/contexts/toast-context";
import { useFormDialog, type UseFormDialogReturn } from "@/lib/hooks/use-form-dialog";
import { useSortableData } from "@/lib/hooks/use-sortable-data";
import { useBulkSelection } from "@/lib/hooks/use-bulk-selection";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { SwipeableListItem } from "@/components/ui/swipeable-list-item";

export type TenantsViewProps = { density?: "comfortable" | "compact" };

export type TenantsViewRef = {
  /** `prefill` seeds the create form — used when adding a tenant from a property detail,
   *  so the property the user came from is already selected. */
  openDialog: (prefill?: Partial<TenantFormData>) => void;
};

function TenantForm({
  dialog,
  properties,
}: {
  dialog: UseFormDialogReturn<TenantFormData, Tenant>;
  properties: Array<{ id: string; name: string }>;
}) {
  const [showMore, setShowMore] = useState(!dialog.editingItem ? false : true);
  const isEdit = !!dialog.editingItem;
  const t = useTranslations("tenants");
  const tForms = useTranslations("forms");
  const tStatus = useTranslations("status");
  const tActions = useTranslations("actions");

  return (
    <form onSubmit={dialog.handleSubmit} className="space-y-4">
      {/* Required fields — always visible */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">{tForms("fullName")}</Label>
          <Input
            id="name"
            value={dialog.formData.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              dialog.updateFormData({ name: e.target.value })
            }
            className={dialog.formErrors.name ? "border-red-500" : ""}
            required
          />
          {dialog.formErrors.name && (
            <p className="text-sm text-destructive">{dialog.formErrors.name}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{tForms("email")}</Label>
          <Input
            id="email"
            type="email"
            value={dialog.formData.email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              dialog.updateFormData({ email: e.target.value })
            }
            className={dialog.formErrors.email ? "border-red-500" : ""}
            required
          />
          {dialog.formErrors.email && (
            <p className="text-sm text-destructive">{dialog.formErrors.email}</p>
          )}
        </div>
      </div>

      {/* Additional details — collapsible on create, always open on edit */}
      {!isEdit && (
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")}
            aria-hidden="true"
          />
          {showMore ? t("moreDetailsHide") : t("moreDetailsShow")}
        </button>
      )}

      {(showMore || isEdit) && (
        <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">{tForms("phone")}</Label>
              <Input
                id="phone"
                value={dialog.formData.phone ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  dialog.updateFormData({ phone: e.target.value })
                }
                className={dialog.formErrors.phone ? "border-red-500" : ""}
              />
              {dialog.formErrors.phone && (
                <p className="text-sm text-destructive">{dialog.formErrors.phone}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="property">{tForms("property")}</Label>
              <Select
                value={dialog.formData.propertyId ?? ""}
                onValueChange={(value: string) => dialog.updateFormData({ propertyId: value })}
              >
                <SelectTrigger className={dialog.formErrors.propertyId ? "border-red-500" : ""}>
                  <SelectValue placeholder={tForms("selectProperty")} />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dialog.formErrors.propertyId && (
                <p className="text-sm text-destructive">{dialog.formErrors.propertyId}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rent">{t("monthlyRent")}</Label>
              <Input
                id="rent"
                type="number"
                min="0"
                value={dialog.formData.rent ?? 0}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  dialog.updateFormData({ rent: parseInt(e.target.value) || 0 })
                }
                className={dialog.formErrors.rent ? "border-red-500" : ""}
              />
              {dialog.formErrors.rent && (
                <p className="text-sm text-destructive">{dialog.formErrors.rent}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="leaseStart">{tForms("leaseStart")}</Label>
              <Input
                id="leaseStart"
                type="date"
                value={dialog.formData.leaseStart ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  dialog.updateFormData({ leaseStart: e.target.value })
                }
                className={dialog.formErrors.leaseStart ? "border-red-500" : ""}
              />
              {dialog.formErrors.leaseStart && (
                <p className="text-sm text-destructive">{dialog.formErrors.leaseStart}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="leaseEnd">{tForms("leaseEnd")}</Label>
              <Input
                id="leaseEnd"
                type="date"
                value={dialog.formData.leaseEnd ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  dialog.updateFormData({ leaseEnd: e.target.value })
                }
                className={dialog.formErrors.leaseEnd ? "border-red-500" : ""}
              />
              {dialog.formErrors.leaseEnd && (
                <p className="text-sm text-destructive">{dialog.formErrors.leaseEnd}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paymentStatus">{t("paymentStatus")}</Label>
              {isEdit ? (
                <p className="text-sm text-muted-foreground">{t("paymentStatusDerived")}</p>
              ) : (
                <Select
                  value={dialog.formData.paymentStatus}
                  onValueChange={(value: Tenant["paymentStatus"]) =>
                    dialog.updateFormData({ paymentStatus: value })
                  }
                >
                  <SelectTrigger
                    className={dialog.formErrors.paymentStatus ? "border-red-500" : ""}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">{tStatus("paid")}</SelectItem>
                    <SelectItem value="pending">{tStatus("pending")}</SelectItem>
                    <SelectItem value="overdue">{tStatus("overdue")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {dialog.formErrors.paymentStatus && (
                <p className="text-sm text-destructive">{dialog.formErrors.paymentStatus}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{tForms("notes")}</Label>
            <Textarea
              id="notes"
              value={dialog.formData.notes ?? ""}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                dialog.updateFormData({ notes: e.target.value })
              }
              rows={3}
              className={dialog.formErrors.notes ? "border-red-500" : ""}
            />
            {dialog.formErrors.notes && (
              <p className="text-sm text-destructive">{dialog.formErrors.notes}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={dialog.closeDialog}>
          {tActions("cancel")}
        </Button>
        <Button type="submit" loading={dialog.isSubmitting}>
          {dialog.editingItem ? t("submitUpdate") : t("submitCreate")}
        </Button>
      </div>
    </form>
  );
}

export const TenantsView = forwardRef<TenantsViewRef, TenantsViewProps>(
  function TenantsView(_props, ref): React.ReactElement {
    const { state, addTenant, updateTenant, deleteTenant } = useApp();
    const { tenants, properties, loading } = state;
    const { leases } = state;
    const { success } = useToast();
    const { formatCurrency } = useCurrency();
    const t = useTranslations("tenants");
    const tForms = useTranslations("forms");
    const tStatus = useTranslations("status");
    const tActions = useTranslations("actions");
    const locale = useLocale();
    const confirmDialog = useConfirmDialog();
    const compact = true; // Always compact

    // Tenant detail overlay — opened via the shared `?detail=tenant:<id>` mechanism
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const openTenantOverlay = (tenantId: string) => {
      router.push(withEntityDetail(pathname, searchParams.toString(), "tenant", tenantId));
    };

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState("");
    const [propertyFilter, setPropertyFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>(() => {
      if (typeof window !== "undefined") {
        return localStorage.getItem("situs-tenants-status-filter") ?? "all";
      }
      return "all";
    });

    // Bulk selection
    const bulkSelection = useBulkSelection<Tenant>();

    // Data view mode state with localStorage persistence
    const [dataViewMode, setDataViewMode] = useState<DataViewMode>("grid");
    useEffect(() => {
      const saved = localStorage.getItem("situs-tenants-view-mode");
      if (saved === "grid" || saved === "table") setDataViewMode(saved);
    }, []);
    const handleViewModeChange = useCallback((mode: DataViewMode) => {
      setDataViewMode(mode);
      localStorage.setItem("situs-tenants-view-mode", mode);
    }, []);

    const initialFormData: TenantFormData = {
      name: "",
      email: "",
      phone: "",
      propertyId: "",
      rent: 0,
      leaseStart: "",
      leaseEnd: "",
      paymentStatus: "pending",
      notes: "",
    };

    const dialog = useFormDialog<TenantFormData, Tenant>({
      schema: tenantSchema,
      initialData: initialFormData,
      onSubmit: async (data, isEdit) => {
        if (isEdit && dialog.editingItem) {
          await updateTenant(dialog.editingItem.id, data);
        } else {
          await addTenant(data);
        }
      },
      successMessage: {
        create: t("toastCreated"),
        update: t("toastUpdated"),
      },
      validation: { validateOnChange: true, debounceValidation: 300 },
    });

    // Expose dialog methods to parent via ref
    useImperativeHandle(ref, () => ({
      openDialog: (prefill?: Partial<TenantFormData>) => {
        dialog.openDialog();
        if (prefill) dialog.updateFormData(prefill);
      },
    }));

    const getPaymentStatusBadge = (status: Tenant["paymentStatus"]) => {
      switch (status) {
        case "paid":
          return <Badge variant="success">{tStatus("paid")}</Badge>;
        case "overdue":
          return <Badge variant="destructive">{tStatus("overdue")}</Badge>;
        case "pending":
          return <Badge variant="secondary">{tStatus("pending")}</Badge>;
      }
    };

    // Bulk delete handler
    const handleBulkDelete = useCallback(
      async (ids: string[]) => {
        confirmDialog.confirm(
          {
            title: t("deleteMany.title"),
            description: t("deleteMany.description", { count: ids.length }),
            confirmLabel: t("deleteMany.confirmLabel"),
            variant: "destructive",
            count: ids.length,
          },
          async () => {
            for (const id of ids) {
              await deleteTenant(id);
            }
            success(t("toastBulkDeleted", { count: ids.length }));
            bulkSelection.clearSelection();
          },
        );
      },
      [deleteTenant, success, bulkSelection, confirmDialog, t],
    );

    // Single delete handler
    /** Row menu, shared by the table row and its mobile card so the two can't drift. */
    const renderTenantActions = (tenant: Tenant) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={t("optionsFor", { name: tenant.name })}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              dialog.openEditDialog(tenant, (t) => ({
                name: t.name,
                email: t.email,
                phone: t.phone || "",
                propertyId: t.propertyId || "",
                rent: Number(t.rent),
                leaseStart: t.leaseStart || "",
                leaseEnd: t.leaseEnd || "",
                paymentStatus: t.paymentStatus,
                notes: t.notes || "",
              }));
            }}
          >
            <Edit className="h-4 w-4 mr-2" />
            {tActions("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = `mailto:${tenant.email}`;
            }}
          >
            <Mail className="h-4 w-4 mr-2" />
            {t("sendEmail")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(tenant);
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {tActions("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const handleDelete = useCallback(
      async (tenant: Tenant) => {
        confirmDialog.confirm(
          {
            title: t("deleteOne.title"),
            description: t("deleteOne.description", { name: tenant.name }),
            confirmLabel: t("deleteOne.confirmLabel"),
            variant: "destructive",
          },
          async () => {
            await deleteTenant(tenant.id);
            success(t("toastDeleted", { name: tenant.name }));
          },
        );
      },
      [deleteTenant, success, confirmDialog, t],
    );

    // Export selected tenants
    const handleExportSelected = useCallback(
      (ids: string[]) => {
        const selectedTenants = tenants.filter((t) => ids.includes(t.id));
        const csvContent = [
          [
            tForms("fullName"),
            tForms("email"),
            tForms("phone"),
            tForms("property"),
            tForms("rent"),
            tForms("status"),
          ].join(","),
          ...selectedTenants.map((t) =>
            [t.name, t.email, t.phone, t.propertyName || "", t.rent, t.paymentStatus].join(","),
          ),
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tenants-export-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      [tenants, tForms],
    );

    // Bulk actions configuration
    const bulkActions = useMemo(
      () =>
        getDefaultBulkActions({
          onDelete: handleBulkDelete,
          onExport: handleExportSelected,
        }),
      [handleBulkDelete, handleExportSelected],
    );

    // Filter and search tenants
    const filteredTenants = useMemo(() => {
      return tenants.filter((tenant) => {
        const matchesSearch =
          searchQuery.length === 0 ||
          tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          tenant.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          tenant.phone.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesProperty = propertyFilter === "all" || tenant.propertyId === propertyFilter;

        // Handle both active/inactive and payment status filters
        let matchesStatus = true;
        if (statusFilter === "active") {
          // Active tenants have a property assigned
          matchesStatus = !!tenant.propertyId;
        } else if (statusFilter === "inactive") {
          // Inactive tenants don't have a property assigned
          matchesStatus = !tenant.propertyId;
        } else if (statusFilter !== "all") {
          // Payment status filters (paid, pending, overdue)
          matchesStatus = tenant.paymentStatus === statusFilter;
        }

        return matchesSearch && matchesProperty && matchesStatus;
      });
    }, [tenants, searchQuery, propertyFilter, statusFilter]);

    // Sorting
    const {
      sortedData: sortedTenants,
      requestSort,
      getSortDirection,
    } = useSortableData(filteredTenants);

    return (
      <>
        {loading ? (
          <LoadingState variant="cards" count={6} />
        ) : (
          <div className="space-y-6">
            <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
              <DialogTrigger asChild>
                <Button onClick={dialog.openDialog} className="hidden">
                  <Plus className="w-4 h-4" />
                  {t("dialogCreateTitle")}
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[var(--color-card-solid)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-[var(--color-foreground)]">
                    {dialog.editingItem ? t("dialogEditTitle") : t("dialogCreateTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {dialog.editingItem ? t("dialogEditDescription") : t("dialogCreateDescription")}
                  </DialogDescription>
                </DialogHeader>
                <TenantForm dialog={dialog} properties={properties} />
              </DialogContent>
            </Dialog>

            {/* Search, filters and the view toggle share one utility row. The toggle used to sit
                on a line of its own between the filters and the list — a full band of chrome for
                a control most people touch once. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchFilter
                className="flex-1"
                searchPlaceholder={t("searchPlaceholder")}
                onSearchChange={setSearchQuery}
                onFilterChange={(key, value) => {
                  if (key === "property") setPropertyFilter(value);
                  if (key === "status") {
                    setStatusFilter(value);
                    localStorage.setItem("situs-tenants-status-filter", value);
                  }
                }}
                filters={[
                  {
                    key: "property",
                    label: tForms("property"),
                    options: [
                      { label: tForms("allProperties"), value: "all" },
                      ...properties.map((property) => ({
                        label: property.name,
                        value: property.id,
                      })),
                    ],
                    defaultValue: "all",
                  },
                  {
                    key: "status",
                    label: tForms("status"),
                    options: [
                      { label: tStatus("all"), value: "all" },
                      { label: tStatus("active"), value: "active" },
                      { label: tStatus("inactive"), value: "inactive" },
                      { label: tStatus("paid"), value: "paid" },
                      { label: tStatus("pending"), value: "pending" },
                      { label: tStatus("overdue"), value: "overdue" },
                    ],
                    defaultValue: "all",
                  },
                ]}
              />
              <DataViewToggle mode={dataViewMode} onChange={handleViewModeChange} />
            </div>

            {dataViewMode === "table" ? (
              /* Table View */
              filteredTenants.length === 0 ? (
                <EmptyStateIllustration
                  type="tenants"
                  onAction={dialog.openDialog}
                  compact={compact}
                />
              ) : (
                <RenderTable
                  data={sortedTenants}
                  rowKey={(tenant) => tenant.id}
                  onRowClick={(tenant) => openTenantOverlay(tenant.id)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card-solid)]"
                  cardMode
                  renderCard={(tenant) => (
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card-solid)] p-4">
                      <div className="flex items-start justify-between gap-2">
                        {/* `py-3 -my-3` buys a 44px hit area without changing the layout — a
                            single line of 14px text is only a 20px target otherwise. */}
                        <button
                          type="button"
                          onClick={() => openTenantOverlay(tenant.id)}
                          className="-my-3 min-w-0 flex-1 py-3 text-left"
                        >
                          <span className="block truncate text-sm font-medium text-[var(--color-foreground)]">
                            {tenant.name}
                          </span>
                          <span
                            className="block break-words text-xs text-[var(--color-muted-foreground)] md:truncate"
                            title={tenant.email}
                          >
                            {tenant.email}
                          </span>
                        </button>
                        <div className="shrink-0">{renderTenantActions(tenant)}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm text-[var(--color-muted-foreground)]">
                          {properties.find((p) => p.id === tenant.propertyId)?.name ||
                            tenant.propertyName ||
                            t("unassigned")}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--color-foreground)]">
                            {formatCurrency(
                              Number(getActiveLease(tenant.id, leases)?.monthlyRent ?? tenant.rent),
                            )}
                          </span>
                          {getPaymentStatusBadge(tenant.paymentStatus)}
                        </span>
                      </div>
                    </div>
                  )}
                  columns={[
                    {
                      key: "name",
                      header: (
                        <SortableHeader
                          sortKey="name"
                          label={tForms("fullName")}
                          currentSort={getSortDirection("name")}
                          onSort={(key) => requestSort(key as keyof Tenant)}
                        />
                      ),
                      cell: (tenant) => tenant.name,
                      cellClassName: "text-sm font-medium text-[var(--color-foreground)]",
                    },
                    {
                      key: "email",
                      header: tForms("email"),
                      cell: (tenant) => tenant.email,
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "phone",
                      header: tForms("phone"),
                      cell: (tenant) => tenant.phone,
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "property",
                      header: tForms("property"),
                      cell: (tenant) =>
                        properties.find((p) => p.id === tenant.propertyId)?.name ||
                        tenant.propertyName ||
                        t("unassigned"),
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "rent",
                      header: (
                        <SortableHeader
                          sortKey="rent"
                          label={tForms("rent")}
                          currentSort={getSortDirection("rent")}
                          onSort={(key) => requestSort(key as keyof Tenant)}
                        />
                      ),
                      // Derived from the active lease's monthlyRent.
                      cell: (tenant) =>
                        formatCurrency(
                          Number(getActiveLease(tenant.id, leases)?.monthlyRent ?? tenant.rent),
                        ),
                      cellClassName: "text-sm font-medium text-[var(--color-foreground)]",
                    },
                    {
                      key: "paymentStatus",
                      header: (
                        <SortableHeader
                          sortKey="paymentStatus"
                          label={t("paymentStatus")}
                          currentSort={getSortDirection("paymentStatus")}
                          onSort={(key) => requestSort(key as keyof Tenant)}
                        />
                      ),
                      cell: (tenant) => getPaymentStatusBadge(tenant.paymentStatus),
                    },
                    {
                      key: "actions",
                      header: "",
                      headerClassName: "w-10",
                      cell: (tenant) => renderTenantActions(tenant),
                    },
                  ]}
                />
              )
            ) : (
              <>
                {filteredTenants.length === 0 ? (
                  <EmptyStateIllustration
                    type="tenants"
                    onAction={dialog.openDialog}
                    compact={compact}
                  />
                ) : (
                  <div className="space-y-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
                    {sortedTenants.map((tenant) => {
                      const isSelected = bulkSelection.isSelected(tenant.id);
                      const activeLease = getActiveLease(tenant.id, leases);
                      const isExpiring = activeLease
                        ? (() => {
                            const end = new Date(activeLease.endDate);
                            const inThirty = new Date();
                            inThirty.setDate(inThirty.getDate() + 30);
                            return end >= new Date() && end <= inThirty;
                          })()
                        : false;
                      const isOverdue = tenant.paymentStatus === "overdue";
                      return (
                        <SwipeableListItem
                          key={tenant.id}
                          className={cn(
                            "border-b border-[var(--color-border)] last:border-b-0",
                            isOverdue && "border-l-2 border-l-red-500/60",
                            isSelected && "bg-[var(--color-surface-pressed)]",
                          )}
                          startAction={{
                            icon: <Eye className="h-5 w-5" />,
                            label: t("open"),
                            className: "bg-accent-primary",
                            onAction: () => openTenantOverlay(tenant.id),
                          }}
                          endAction={{
                            icon: <Trash2 className="h-5 w-5" />,
                            label: tActions("delete"),
                            className: "bg-destructive",
                            onAction: () => handleDelete(tenant),
                          }}
                        >
                          <div
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)] cursor-pointer",
                            )}
                            onClick={() => openTenantOverlay(tenant.id)}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => bulkSelection.toggleSelection(tenant.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0"
                            />

                            {/* Avatar + name + email */}
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-primary/20 ring-1 ring-accent-primary/30 text-xs font-semibold text-accent-primary">
                                {tenant.name
                                  .split(" ")
                                  .map((n: string) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="truncate text-sm font-medium text-[var(--color-foreground)]"
                                  title={tenant.name}
                                >
                                  {tenant.name}
                                </p>
                                {/* Wraps below `md`, truncates above it. `truncate` alone clipped
                                    `ana.martinez@gmail.com` by 37px at 390px with no way to read
                                    the rest: `title` is a hover tooltip, and a phone has no
                                    hover. Above `md` the row is column-aligned and a wrap would
                                    break the alignment, so truncation is right there. */}
                                <p
                                  className="break-words text-xs text-[var(--color-muted-foreground)] md:truncate"
                                  title={tenant.email}
                                >
                                  {tenant.email}
                                </p>
                              </div>
                            </div>

                            {/* Property */}
                            <div className="hidden w-36 shrink-0 truncate text-xs text-[var(--color-muted-foreground)] md:block">
                              {properties.find((p) => p.id === tenant.propertyId)?.name ||
                                tenant.propertyName ||
                                t("unassigned")}
                            </div>

                            {/* Lease end */}
                            <div className="hidden w-[88px] shrink-0 flex-col items-end text-xs lg:flex">
                              {activeLease ? (
                                <>
                                  <span className="text-[var(--color-muted-foreground)]">
                                    {t("endsLabel")}
                                  </span>
                                  <span
                                    className={cn(
                                      "font-medium",
                                      isExpiring
                                        ? "text-[var(--color-warning)]"
                                        : "text-[var(--color-muted-foreground)]",
                                    )}
                                  >
                                    {new Date(activeLease.endDate).toLocaleDateString(locale, {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </span>
                                </>
                              ) : null}
                            </div>

                            {/* Rent */}
                            <div className="hidden w-20 shrink-0 text-right text-sm font-semibold text-[var(--color-foreground)] sm:block">
                              {formatCurrency(Number(activeLease?.monthlyRent ?? tenant.rent))}
                            </div>

                            {/* Status badge */}
                            <div className="shrink-0">
                              {getPaymentStatusBadge(tenant.paymentStatus)}
                            </div>

                            {/* Actions menu — the shared helper, so the list and the
                                table row can't drift on what a tenant lets you do. */}
                            {renderTenantActions(tenant)}
                          </div>
                        </SwipeableListItem>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <BulkActionBar
              selectedCount={bulkSelection.selectedCount}
              totalCount={sortedTenants.length}
              itemLabel={t("itemLabel")}
              actions={bulkActions}
              onSelectAll={() => bulkSelection.selectAll(sortedTenants)}
              onClearSelection={bulkSelection.clearSelection}
              isAllSelected={bulkSelection.isAllSelected(sortedTenants)}
              isPartiallySelected={bulkSelection.isPartiallySelected(sortedTenants)}
              selectedIds={Array.from(bulkSelection.selectedIds)}
            />
          </div>
        )}

        <ConfirmationDialog dialog={confirmDialog} />
      </>
    );
  },
);

TenantsView.displayName = "TenantsView";
