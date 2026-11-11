"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  Download,
  MoreHorizontal,
  Clock,
  TrendingUp,
  Mail,
} from "lucide-react";
import { SortableHeader } from "@/components/ui/sortable-header";
import { RenderTable } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrency } from "@/lib/contexts/currency-context";
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
import { LoadingState } from "@/components/ui/loading-state";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/utils";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { SearchFilter } from "@/components/ui/search-filter";
import { ExportButton } from "@/components/ui/export-button";
import { useApp } from "@/lib/contexts/app-context";
import { Lease } from "@/lib/types";
import { useToast } from "@/lib/contexts/toast-context";
import { wasReported } from "@/lib/utils/api-error";
import { downloadContract } from "./lease-contract";
import { TenancySheet } from "./tenancy-sheet";
import { useSortableData } from "@/lib/hooks/use-sortable-data";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { StatusMark } from "@/components/ui/status-mark";
import { leaseStatus } from "@/lib/utils/status-tone";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";

export type LeasesViewProps = Record<string, never>;

export function LeasesView(): React.ReactElement {
  const { state, updateLease, deleteLease } = useApp();
  const { properties, tenants, leases, loading } = state;
  const { success, error } = useToast();
  const { formatCurrency } = useCurrency();
  const confirmDialog = useConfirmDialog();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("leases");
  const tNav = useTranslations("navigation");
  const openLeaseOverlay = (leaseId: string) => {
    router.push(withEntityDetail(pathname, searchParams.toString(), "lease", leaseId));
  };
  // The New tenancy sheet: creates a tenancy, or edits the lease in `editingLease`.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ propertyId?: string; tenantId?: string }>({});
  const [editingLease, setEditingLease] = useState<Lease | null>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Bulk selection state
  const [selectedLeaseIds, setSelectedLeaseIds] = useState<Set<string>>(new Set());
  const [bulkIncreaseOpen, setBulkIncreaseOpen] = useState(false);
  const [bulkPct, setBulkPct] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);

  const statusLabel = (status: string) => {
    switch (status) {
      case "active":
        return t("active");
      case "expired":
        return t("expired");
      case "terminated":
        return t("terminated");
      case "pending":
        return t("pending");
      default:
        return status;
    }
  };
  const getStatusBadge = (status: string) => (
    <StatusMark {...leaseStatus(status)}>{statusLabel(status)}</StatusMark>
  );

  const openNewTenancy = () => {
    setEditingLease(null);
    setPrefill({});
    setSheetOpen(true);
  };

  const handleEdit = (lease: Lease) => {
    setEditingLease(lease);
    setSheetOpen(true);
  };

  const handleDelete = (id: string) => {
    confirmDialog.confirm(
      {
        title: t("deleteDialog.title"),
        description: t("deleteDialog.description"),
        confirmLabel: t("deleteDialog.confirmLabel"),
        variant: "destructive",
      },
      async () => {
        await deleteLease(id);
        success(t("toast.deleted"));
      },
    );
  };

  const toggleLeaseSelection = (id: string) => {
    setSelectedLeaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (visibleIds: string[]) => {
    if (
      selectedLeaseIds.size === visibleIds.length &&
      visibleIds.every((id) => selectedLeaseIds.has(id))
    ) {
      setSelectedLeaseIds(new Set());
    } else {
      setSelectedLeaseIds(new Set(visibleIds));
    }
  };

  const handleBulkRentIncrease = async () => {
    const pct = parseFloat(bulkPct);
    if (isNaN(pct) || pct <= 0 || pct > 100) return;
    setBulkApplying(true);
    try {
      for (const id of selectedLeaseIds) {
        const lease = leases.find((l) => l.id === id);
        if (!lease) continue;
        const newRent = Math.round(lease.monthlyRent * (1 + pct / 100) * 100) / 100;
        await updateLease(id, { monthlyRent: newRent });
      }
      success(t("toast.rentIncreased", { pct, count: selectedLeaseIds.size }));
      setBulkIncreaseOpen(false);
      setBulkPct("");
      setSelectedLeaseIds(new Set());
    } catch (err) {
      // `updateLease` reports its own failures; saying so again would be a second toast.
      if (!wasReported(err)) error(t("toast.rentIncreaseFailed"));
    } finally {
      setBulkApplying(false);
    }
  };

  const handleDownloadNotices = () => {
    const pct = parseFloat(bulkPct);
    const today = new Date().toLocaleDateString(locale);
    const lines: string[] = [];
    for (const id of selectedLeaseIds) {
      const lease = leases.find((l) => l.id === id);
      const tenant = tenants.find((t) => t.id === lease?.tenantId);
      const property = properties.find((p) => p.id === lease?.propertyId);
      if (!lease || !tenant || !property) continue;
      const newRent = isNaN(pct)
        ? lease.monthlyRent
        : Math.round(lease.monthlyRent * (1 + pct / 100) * 100) / 100;
      lines.push(
        `Dear ${tenant.name},`,
        ``,
        `We are writing to inform you that the monthly rent for the property at`,
        `${property.address} will be updated as follows:`,
        ``,
        `  Current rent: ${formatCurrency(lease.monthlyRent)}/month`,
        `  New rent:     ${formatCurrency(newRent)}/month${isNaN(pct) ? "" : ` (${pct}% increase)`}`,
        `  Effective:    ${today}`,
        ``,
        `If you have any questions, please contact us.`,
        ``,
        `Kind regards,`,
        `Property Management`,
        ``,
        `${"─".repeat(60)}`,
        ``,
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rent-increase-notices-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Open the sheet from a link elsewhere:
  // - `?action=edit|renew&id=X` (lease detail, tenant modal) edits lease X;
  // - `?action=create&tenantId=Y` is the tenant modal's "Add lease". It starts a new tenancy with
  //   that tenant chosen, and their property when they have one. This case was never handled, so
  //   the button landed on the list and did nothing.
  const handledQuery = useRef<string | null>(null);
  useEffect(() => {
    const action = searchParams.get("action");
    if (!action || loading) return;
    const query = searchParams.toString();
    if (handledQuery.current === query) return;
    if (action === "create") {
      setEditingLease(null);
      setPrefill({ tenantId: searchParams.get("tenantId") ?? undefined });
      setSheetOpen(true);
    } else if (action === "edit" || action === "renew") {
      const target = leases.find((l) => l.id === searchParams.get("id"));
      if (!target) return;
      handleEdit(target);
    } else {
      return;
    }
    // The query stays until the sheet closes. It was cleared on opening, and the screen can
    // mount afresh while the app's data first loads, which lost the open sheet with the query
    // that would have reopened it: the link opened nothing.
    handledQuery.current = query;
  }, [searchParams, leases, tenants, loading]);

  const handleDownloadContract = async (lease: Lease) => {
    try {
      await downloadContract(lease);
    } catch {
      error(t("toast.contractDownloadFailed"));
    }
  };

  // Filter and search leases
  const filteredLeases = useMemo(() => {
    return leases.filter((lease) => {
      // Search filter (tenant name, property name)
      const tenantName = tenants.find((t) => t.id === lease.tenantId)?.name || "";
      const propertyName = properties.find((p) => p.id === lease.propertyId)?.name || "";
      const matchesSearch =
        searchQuery.length === 0 ||
        tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        propertyName.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      const matchesStatus = statusFilter === "all" || lease.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [leases, tenants, properties, searchQuery, statusFilter]);

  // Sorting
  const {
    sortedData: sortedLeases,
    requestSort,
    getSortDirection,
  } = useSortableData(filteredLeases);

  const expiringSoon = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + 60);
    return leases.filter((l) => {
      if (l.status !== "active") return false;
      const end = new Date(l.endDate);
      return end >= now && end <= cutoff;
    });
  }, [leases]);

  // Shared between the table row and its card fallback below `md`, so the two layouts
  // can never drift on what a lease lets you do.
  const renderLeaseActions = (lease: Lease) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("leaseOptions")}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleEdit(lease)}>
          <Edit className="h-4 w-4 mr-2" />
          {t("editLease")}
        </DropdownMenuItem>
        {lease.contractFileName ? (
          <DropdownMenuItem onClick={() => void handleDownloadContract(lease)}>
            <Download className="h-4 w-4 mr-2" />
            {t("contractDownload")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(lease.id)}>
          <Trash2 className="h-4 w-4 mr-2" />
          {t("deleteLease")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const leaseColumns = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={sortedLeases.length > 0 && sortedLeases.every((l) => selectedLeaseIds.has(l.id))}
          onChange={() => toggleSelectAll(sortedLeases.map((l) => l.id))}
          aria-label={t("selectAll")}
        />
      ),
      headerClassName: "w-10 pl-4",
      cellClassName: "pl-4 w-10",
      cell: (lease: Lease) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selectedLeaseIds.has(lease.id)}
            onChange={() => toggleLeaseSelection(lease.id)}
            aria-label={t("selectOne", { name: lease.tenant?.name ?? lease.id })}
          />
        </span>
      ),
    },
    {
      key: "property",
      header: t("field.property"),
      headerClassName: "text-[var(--color-muted-foreground)]",
      cellClassName: "text-sm text-[var(--color-foreground)]",
      cell: (lease: Lease) => lease.property?.name,
    },
    {
      key: "tenant",
      header: t("field.tenant"),
      headerClassName: "text-[var(--color-muted-foreground)]",
      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
      cell: (lease: Lease) => lease.tenant?.name,
    },
    {
      key: "startDate",
      header: (
        <SortableHeader
          sortKey="startDate"
          label={t("field.start")}
          currentSort={getSortDirection("startDate")}
          onSort={(key) => requestSort(key as keyof Lease)}
        />
      ),
      headerClassName: "text-[var(--color-muted-foreground)]",
      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
      cell: (lease: Lease) => new Date(lease.startDate).toLocaleDateString(locale),
    },
    {
      key: "endDate",
      header: t("field.end"),
      headerClassName: "text-[var(--color-muted-foreground)]",
      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
      cell: (lease: Lease) => new Date(lease.endDate).toLocaleDateString(locale),
    },
    {
      key: "monthlyRent",
      header: (
        <SortableHeader
          sortKey="monthlyRent"
          label={t("field.monthlyRent")}
          currentSort={getSortDirection("monthlyRent")}
          onSort={(key) => requestSort(key as keyof Lease)}
        />
      ),
      headerClassName: "text-[var(--color-muted-foreground)]",
      cellClassName: "text-sm font-medium text-[var(--color-foreground)]",
      cell: (lease: Lease) => formatCurrency(lease.monthlyRent),
    },
    {
      key: "status",
      header: (
        <SortableHeader
          sortKey="status"
          label={t("field.status")}
          currentSort={getSortDirection("status")}
          onSort={(key) => requestSort(key as keyof Lease)}
        />
      ),
      headerClassName: "text-[var(--color-muted-foreground)]",
      cell: (lease: Lease) => getStatusBadge(lease.status),
    },
    {
      key: "actions",
      header: t("field.actions"),
      headerClassName: "text-[var(--color-muted-foreground)] w-24",
      cell: (lease: Lease) => (
        <span onClick={(e) => e.stopPropagation()}>{renderLeaseActions(lease)}</span>
      ),
    },
  ];

  const renderLeaseCard = (lease: Lease) => (
    <div
      className={cn(
        "border border-[var(--color-border)] bg-[var(--color-card)] p-4",
        selectedLeaseIds.has(lease.id) && "border-[var(--color-info)] bg-[var(--color-info-muted)]",
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selectedLeaseIds.has(lease.id)}
          onChange={() => toggleLeaseSelection(lease.id)}
          aria-label={t("selectOne", { name: lease.tenant?.name ?? lease.id })}
        />
        <button
          type="button"
          className="min-h-11 min-w-0 flex-1 text-left"
          onClick={() => openLeaseOverlay(lease.id)}
        >
          <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
            {lease.property?.name}
          </p>
          <p className="truncate text-sm text-[var(--color-muted-foreground)]">
            {lease.tenant?.name}
          </p>
        </button>
        {getStatusBadge(lease.status)}
        {renderLeaseActions(lease)}
      </div>
      <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span className="font-medium text-[var(--color-foreground)]">
          {formatCurrency(lease.monthlyRent)}
        </span>
        <span className="text-[var(--color-muted-foreground)]">
          {new Date(lease.startDate).toLocaleDateString(locale)} →{" "}
          {new Date(lease.endDate).toLocaleDateString(locale)}
        </span>
      </p>
    </div>
  );

  if (loading) {
    return <LoadingState variant="cards" count={6} />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader title={tNav("contracts")}>
          <ExportButton
            data={sortedLeases}
            filename="leases"
            columns={[
              {
                key: "tenantId",
                label: t("field.tenant"),
                format: (value) => tenants.find((tn) => tn.id === value)?.name || t("unknown"),
              },
              {
                key: "propertyId",
                label: t("field.property"),
                format: (value) => properties.find((p) => p.id === value)?.name || t("unknown"),
              },
              {
                key: "startDate",
                label: t("field.startDate"),
                format: (value) => new Date(value as string).toLocaleDateString(locale),
              },
              {
                key: "endDate",
                label: t("field.endDate"),
                format: (value) => new Date(value as string).toLocaleDateString(locale),
              },
              {
                key: "monthlyRent",
                label: t("field.monthlyRent"),
                format: (value) => formatCurrency(value as number),
              },
              {
                key: "deposit",
                label: t("field.deposit"),
                format: (value) => formatCurrency(value as number),
              },
              { key: "status", label: t("field.status") },
            ]}
          />

          <Button onClick={openNewTenancy} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {t("sheet.title")}
          </Button>
        </PageHeader>

        {/* One toolbar row: search, filter and the view toggle */}
        <div className="flex items-start gap-3">
          <SearchFilter
            className="min-w-0 flex-1"
            searchPlaceholder={t("searchPlaceholder")}
            onSearchChange={setSearchQuery}
            onFilterChange={(key, value) => {
              if (key === "status") setStatusFilter(value);
            }}
            filters={[
              {
                key: "status",
                label: t("field.status"),
                options: [
                  { label: t("filter.allStatuses"), value: "all" },
                  { label: t("active"), value: "active" },
                  { label: t("pending"), value: "pending" },
                  { label: t("expired"), value: "expired" },
                  { label: t("terminated"), value: "terminated" },
                ],
                defaultValue: "all",
              },
            ]}
          />
        </div>

        {expiringSoon.length > 0 && (
          <div className="flex items-start gap-3 border border-[var(--semantic-warning)] bg-[var(--semantic-warning-soft)] p-4 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--semantic-warning-readable)]" />
            <div>
              <p className="font-medium text-[var(--semantic-warning-readable)]">
                {t("expiringSoon", { count: expiringSoon.length })}
              </p>
              <p className="mt-1 text-[var(--color-muted-foreground)]">
                {expiringSoon
                  .map((l) => {
                    const tenant = tenants.find((tn) => tn.id === l.tenantId)?.name ?? t("unknown");
                    const end = new Date(l.endDate).toLocaleDateString(locale);
                    return `${tenant} (${end})`;
                  })
                  .join(" · ")}
              </p>
            </div>
          </div>
        )}

        {/* One list: a table from `md` up, the lease cards below it (`RenderTable` cardMode). A
            grid/table switch used to sit beside the search, so the same leases had two layouts to
            choose between and the bulk rent increase existed only in one of them. */}
        {filteredLeases.length === 0 ? (
          leases.length === 0 && properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="h-12 w-12 text-[var(--color-muted-foreground)] mb-4" />
              <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
                {t("emptyTitle")}
              </h3>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-6 max-w-md">
                {t("emptyDescription")}
              </p>
              <Button variant="outline" size="sm" onClick={() => router.push("/portfolio")}>
                <Plus className="w-4 h-4 mr-2" /> {t("createProperty")}
              </Button>
            </div>
          ) : (
            <EmptyStateIllustration
              type={leases.length === 0 ? "leases" : "generic"}
              title={leases.length === 0 ? undefined : t("noneFound")}
              description={leases.length === 0 ? undefined : t("adjustFilters")}
              onAction={leases.length === 0 ? openNewTenancy : undefined}
              actionLabel={leases.length === 0 ? t("addFirst") : undefined}
            />
          )
        ) : (
          <>
            {/* Bulk actions bar */}
            {selectedLeaseIds.size > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--color-info-muted)] border border-[var(--color-info)]/30">
                <span className="text-sm font-medium text-[var(--color-info)]">
                  {t("bulk.selected", { count: selectedLeaseIds.size })}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Dialog open={bulkIncreaseOpen} onOpenChange={setBulkIncreaseOpen}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[var(--color-info)]/40 text-[var(--color-info)]"
                      >
                        <TrendingUp className="h-4 w-4 mr-1.5" />
                        {t("bulk.increaseRent")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[380px]">
                      <DialogHeader>
                        <DialogTitle>{t("bulk.title")}</DialogTitle>
                        <DialogDescription>
                          {t("bulkDescription", { count: selectedLeaseIds.size })}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="bulk-pct">{t("bulk.percentLabel")}</Label>
                          <div className="flex gap-2">
                            <Input
                              id="bulk-pct"
                              type="number"
                              min="0.1"
                              max="100"
                              step="0.1"
                              placeholder={t("bulk.percentPlaceholder")}
                              value={bulkPct}
                              onChange={(e) => setBulkPct(e.target.value)}
                              className="flex-1"
                            />
                            <span className="flex items-center text-sm text-[var(--color-muted-foreground)]">
                              %
                            </span>
                          </div>
                        </div>

                        {/* Preview */}
                        {bulkPct && !isNaN(parseFloat(bulkPct)) && parseFloat(bulkPct) > 0 && (
                          <div className="bg-[var(--color-card)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] text-sm max-h-48 overflow-y-auto">
                            {[...selectedLeaseIds].map((id) => {
                              const lease = leases.find((l) => l.id === id);
                              if (!lease) return null;
                              const tenant = tenants.find((t) => t.id === lease.tenantId);
                              const newRent =
                                Math.round(
                                  lease.monthlyRent * (1 + parseFloat(bulkPct) / 100) * 100,
                                ) / 100;
                              return (
                                <div
                                  key={id}
                                  className="flex items-center justify-between px-3 py-2"
                                >
                                  <span className="text-[var(--color-muted-foreground)] truncate max-w-[180px]">
                                    {tenant?.name ?? id}
                                  </span>
                                  <span className="text-[var(--color-muted-foreground)] line-through mr-2">
                                    {formatCurrency(lease.monthlyRent)}
                                  </span>
                                  <span className="text-[var(--semantic-success-readable)] font-medium">
                                    {formatCurrency(newRent)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownloadNotices}
                            disabled={!bulkPct || isNaN(parseFloat(bulkPct))}
                          >
                            <Mail className="h-4 w-4 mr-1.5" />
                            {t("bulk.downloadNotices")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleBulkRentIncrease}
                            disabled={
                              bulkApplying ||
                              !bulkPct ||
                              isNaN(parseFloat(bulkPct)) ||
                              parseFloat(bulkPct) <= 0
                            }
                          >
                            {bulkApplying ? t("bulk.applying") : t("bulk.apply")}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    onClick={() => setSelectedLeaseIds(new Set())}
                  >
                    {t("bulk.clear")}
                  </Button>
                </div>
              </div>
            )}

            <RenderTable
              data={sortedLeases}
              columns={leaseColumns}
              rowKey={(lease) => lease.id}
              cardMode
              renderCard={renderLeaseCard}
              onRowClick={(lease) => openLeaseOverlay(lease.id)}
              rowClassName={(lease) =>
                cn(
                  "border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]",
                  selectedLeaseIds.has(lease.id) && "bg-[var(--color-info-muted)]",
                )
              }
              className="border border-[var(--color-border)] bg-[var(--color-card)]"
            />
          </>
        )}
      </div>
      <TenancySheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setEditingLease(null);
            // Drop the link's query, through the History API: `router.replace` is a navigation,
            // and the page's segment is keyed by its query, so it would mount the screen afresh.
            if (searchParams.get("action")) window.history.replaceState(null, "", pathname);
          }
        }}
        lease={editingLease}
        prefill={prefill}
      />
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}
