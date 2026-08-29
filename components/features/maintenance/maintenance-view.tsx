"use client";

import { useState, useMemo, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, AlertCircle, Clock, CheckCircle, XCircle, MoreVertical, User } from "lucide-react";
import { SortableHeader } from "@/components/ui/sortable-header";
import { RenderTable } from "@/components/ui/table";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { SearchFilter } from "@/components/ui/search-filter";
import { ExportButton } from "@/components/ui/export-button";
import { useApp } from "@/lib/contexts/app-context";
import {
  maintenanceSchema,
  type MaintenanceFormData,
  MAINTENANCE_CATEGORIES,
} from "@/lib/schemas/maintenance.schema";
import { MaintenanceTicket } from "@/lib/types";
import { useToast } from "@/lib/contexts/toast-context";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import { useSortableData } from "@/lib/hooks/use-sortable-data";
import { MaintenanceStatus, MaintenancePriority } from "@/lib/types";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { TicketDetailModal } from "./ticket-detail-modal";
import { OperationsKpiRow } from "./operations-kpi-row";
import { OperationsCalendar } from "./operations-calendar";
import { OperationsEvidence } from "./operations-evidence";
import { ContactsView } from "@/components/features/contacts/contacts-view";
import { Tabs, TabsContent, TabsList, TabsMobileSelect, TabsTrigger } from "@/components/ui/tabs";
import { useTabPersistence } from "@/lib/hooks/use-tab-persistence";
import { ListChecks, CalendarDays, Wrench as WrenchIcon, Camera } from "lucide-react";
import { TICKET_STATUS_KEY as STATUS_LABEL_KEY } from "@/lib/utils/maintenance-labels";
import { formatDate } from "@/lib/utils/format-date";

/**
 * Mobile fallback for a ticket row (doctrine rule 3, card strategy). The table's eight columns
 * were 437px wider than the phone could show, so vendor and scheduled date sat off the right
 * edge behind a scroll nobody looks for. The card keeps the same fields but stacks them, and
 * drops the ones that are usually empty ("—") rather than reserving space for a dash.
 */
function TicketCard({
  ticket,
  onOpen,
  actions,
  priorityLabel,
  priorityClass,
  statusLabel,
  statusIcon,
  propertyLabel,
  createdLabel,
  vendorLabel,
  scheduledLabel,
}: {
  ticket: MaintenanceTicket;
  onOpen: () => void;
  actions: React.ReactNode;
  priorityLabel: string;
  priorityClass: string;
  statusLabel: string;
  statusIcon: React.ReactNode;
  propertyLabel: string;
  createdLabel: string;
  vendorLabel: string;
  scheduledLabel: string;
}): React.ReactElement {
  // Labels arrive as props because they need the parent's namespaces; the locale is ambient
  // context, so it is read here rather than threaded through a ninth prop.
  const locale = useLocale();
  const vendor = ticket.vendorName || ticket.assignedTo;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-start justify-between gap-2">
        {/* The whole card is not the tap target — a button around the title keeps the hit area
            explicit and leaves the menu beside it clickable without event juggling.

            `py-3 -my-3` is the hit area, not spacing: one line of 14px text is a 20px button,
            which fails the 24px WCAG floor and is nowhere near the 44px comfortable target.
            The padding takes the border box to 44px and the equal negative margin gives the
            space back to the layout, so the card looks identical and the target is real. */}
        <button
          type="button"
          onClick={onOpen}
          className="-my-3 min-w-0 flex-1 py-3 text-left text-sm font-medium text-[var(--color-foreground)]"
        >
          {ticket.title}
        </button>
        <div className="shrink-0">{actions}</div>
      </div>

      {/* The property names the ticket as much as the title does, so it reads as a subtitle
          rather than as one more labelled field below. */}
      <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{propertyLabel}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={priorityClass}>
          {priorityLabel}
        </Badge>
        <span className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
          {statusIcon}
          {statusLabel}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="mono-label self-center">{createdLabel}</dt>
        <dd className="text-[var(--color-muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            {ticket.isTenantReport && <User className="h-3.5 w-3.5 text-[var(--color-info)]" />}
            {formatDate(ticket.createdAt, locale)}
          </span>
        </dd>
        {vendor && (
          <>
            <dt className="mono-label self-center">{vendorLabel}</dt>
            <dd className="text-[var(--color-muted-foreground)]">{vendor}</dd>
          </>
        )}
        {ticket.scheduledDate && (
          <>
            <dt className="mono-label self-center">{scheduledLabel}</dt>
            <dd className="text-[var(--color-muted-foreground)]">
              {formatDate(ticket.scheduledDate, locale)}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function MaintenanceView(): React.ReactElement {
  const t = useTranslations("maintenance");
  const locale = useLocale();
  const { state, addMaintenance, updateMaintenance, deleteMaintenance } = useApp();
  const { properties, maintenance, loading } = state;
  const { success, error } = useToast();
  const { formatCurrency, currencySymbol } = useCurrency();
  const confirmDialog = useConfirmDialog();

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Detail modal state
  const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Operations subtabs (Task Queue / Calendar / Contractors / Evidence)
  const [activeTab, setActiveTab] = useTabPersistence("operations", "queue");
  const openTicketDetail = useCallback((ticket: MaintenanceTicket) => {
    setSelectedTicket(ticket);
    setIsDetailOpen(true);
  }, []);
  const handleToggleEvidenceRequired = useCallback(
    async (ticket: MaintenanceTicket, required: boolean) => {
      await updateMaintenance(ticket.id, { evidenceRequired: required });
    },
    [updateMaintenance],
  );

  const initialFormData: MaintenanceFormData = {
    propertyId: "",
    tenantId: undefined,
    title: "",
    description: "",
    status: "open",
    priority: "medium",
    category: undefined,
    estimatedCost: undefined,
    scheduledDate: undefined,
    dueDate: undefined,
    vendorName: undefined,
    vendorPhone: undefined,
    invoiceRef: undefined,
    isTenantReport: false,
    cost: undefined,
    assignedTo: undefined,
  };

  const dialog = useFormDialog<MaintenanceFormData, MaintenanceTicket>({
    schema: maintenanceSchema,
    initialData: initialFormData,
    onSubmit: async (data, isEdit) => {
      if (isEdit && dialog.editingItem) {
        await updateMaintenance(dialog.editingItem.id, data);
        success(t("toastUpdated"));
      } else {
        await addMaintenance(data);
        success(t("toastCreated"));
      }
    },
    onError: (errorMessage) => {
      error(errorMessage);
    },
    validation: { validateOnChange: true, debounceValidation: 300 },
  });

  // Filter and search maintenance tickets
  const filteredTickets = useMemo(() => {
    return maintenance.filter((ticket) => {
      // Search filter (title, description, assignedTo)
      const matchesSearch =
        searchQuery.length === 0 ||
        ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ticket.description || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ticket.vendorName || ticket.assignedTo || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      // Status filter
      const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;

      // Priority filter
      const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;

      // Category filter
      const matchesCategory = categoryFilter === "all" || ticket.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
    });
  }, [maintenance, searchQuery, statusFilter, priorityFilter, categoryFilter]);

  // Sorting
  const {
    sortedData: sortedTickets,
    requestSort,
    getSortDirection,
  } = useSortableData(filteredTickets);

  // Cost summary for open/in-progress filtered tickets
  const costSummary = useMemo(() => {
    const open = filteredTickets.filter((t) => t.status === "open" || t.status === "in_progress");
    const total = open.reduce((sum, t) => sum + (t.estimatedCost ?? t.cost ?? 0), 0);
    const withCost = open.filter((t) => (t.estimatedCost ?? t.cost) != null).length;
    return { total, count: open.length, withCost };
  }, [filteredTickets]);

  const handleEdit = (ticket: MaintenanceTicket) => {
    dialog.openEditDialog(ticket, (t) => ({
      propertyId: t.propertyId,
      tenantId: t.tenantId,
      title: t.title,
      description: t.description || "",
      status: t.status,
      priority: t.priority,
      category: t.category as MaintenanceFormData["category"],
      estimatedCost: t.estimatedCost ?? t.cost,
      scheduledDate: t.scheduledDate,
      dueDate: t.dueDate,
      vendorName: t.vendorName ?? t.assignedTo,
      vendorPhone: t.vendorPhone,
      invoiceRef: t.invoiceRef,
      isTenantReport: t.isTenantReport ?? false,
      cost: t.cost,
      assignedTo: t.assignedTo,
    }));
  };

  const handleDelete = useCallback(
    async (ticket: MaintenanceTicket) => {
      confirmDialog.confirm(
        {
          title: t("deleteTitle"),
          description: t("deleteConfirm", { title: ticket.title }),
          confirmLabel: t("delete"),
          variant: "destructive",
        },
        async () => {
          await deleteMaintenance(ticket.id);
          success(t("toastDeleted", { title: ticket.title }));
        },
      );
    },
    [deleteMaintenance, success, confirmDialog, t],
  );

  const handleUpdateStatus = useCallback(
    async (ticket: MaintenanceTicket, newStatus: MaintenanceStatus) => {
      await updateMaintenance(ticket.id, { status: newStatus });
      success(`Ticket status updated to "${newStatus.replace("_", " ")}"`);
    },
    [updateMaintenance, success],
  );

  /**
   * The row menu, shared by the table row and its mobile card so the two can't offer different
   * actions. `stopPropagation` on the trigger keeps a menu click from also firing the row's
   * open-detail handler.
   */
  const renderTicketActions = (ticket: MaintenanceTicket) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("ticketOptions")}>
          <MoreVertical className="w-4 h-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="focus:bg-[var(--color-surface-hover)] cursor-pointer"
          onClick={() => handleEdit(ticket)}
        >
          {t("editDetails")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="focus:bg-[var(--color-surface-hover)] cursor-pointer p-0"
          onSelect={(e) => e.preventDefault()}
        >
          <Select
            value={ticket.status}
            onValueChange={(value) => handleUpdateStatus(ticket, value as MaintenanceStatus)}
          >
            <SelectTrigger className="border-0 bg-transparent h-auto px-2 py-1.5 text-[var(--color-foreground)] shadow-none focus:ring-0">
              <SelectValue placeholder={t("updateStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t("statusOpen")}</SelectItem>
              <SelectItem value="in_progress">{t("statusInProgress")}</SelectItem>
              <SelectItem value="resolved">{t("statusResolved")}</SelectItem>
              <SelectItem value="closed">{t("statusClosed")}</SelectItem>
            </SelectContent>
          </Select>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[var(--color-destructive)] focus:bg-[var(--color-surface-hover)] cursor-pointer"
          onClick={() => handleDelete(ticket)}
        >
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // A clear low->urgent escalation ramp: info, neutral, warning, error —
  // medium and high previously shared the same warning color and were
  // indistinguishable in a ticket list at a glance.
  const getPriorityColor = (priority: MaintenancePriority) => {
    switch (priority) {
      case "low":
        return "bg-[var(--color-info-muted)] text-[var(--color-info)] border-[var(--color-info)]/20";
      case "medium":
        return "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)] border-[var(--color-border)]";
      case "high":
        return "bg-[var(--color-warning-muted)] text-[var(--color-warning)] border-[var(--color-warning)]/20";
      case "urgent":
        return "bg-[var(--color-error-muted)] text-[var(--color-error)] border-[var(--color-error)]/20";
      default:
        return "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]";
    }
  };

  const getStatusIcon = (status: MaintenanceStatus) => {
    switch (status) {
      case "open":
        return <AlertCircle className="w-4 h-4 text-blue-500" />;
      case "in_progress":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case "resolved":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "closed":
        return <XCircle className="w-4 h-4 text-[var(--color-muted-foreground)]" />;
    }
  };

  return (
    <>
      {loading ? (
        <LoadingState variant="cards" count={6} />
      ) : (
        <div className="space-y-6">
          <PageHeader title={t("operationsTitle")} description={t("operationsSubtitle")}>
            <ExportButton
              data={sortedTickets}
              filename="maintenance"
              columns={[
                { key: "title", label: t("fieldTitle") },
                { key: "description", label: t("fieldDescription") },
                {
                  key: "propertyId",
                  label: t("fieldProperty"),
                  format: (value) => properties.find((p) => p.id === value)?.name || t("unknown"),
                },
                { key: "status", label: t("fieldStatus") },
                { key: "priority", label: t("priority") },
                {
                  key: "cost",
                  label: t("fieldCost"),
                  format: (value) => (value ? formatCurrency(value as number) : t("notSet")),
                },
                {
                  key: "vendorName",
                  label: t("fieldVendor"),
                  format: (value) => (value as string) || "—",
                },
              ]}
            />
            <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
              <DialogTrigger asChild>
                <Button onClick={dialog.openDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {t("newTicket")}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>
                    {dialog.editingItem ? t("editTicket") : t("createTicket")}
                  </DialogTitle>
                  <DialogDescription>{t("dialogDescription")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={dialog.handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">{t("fieldTitle")}</Label>
                    <Input
                      id="title"
                      value={dialog.formData.title}
                      onChange={(e) => dialog.updateFormData({ title: e.target.value })}
                      className={dialog.formErrors.title ? "border-red-500" : ""}
                      placeholder={t("titlePlaceholder")}
                    />
                    {dialog.formErrors.title && (
                      <p className="text-sm text-destructive">{dialog.formErrors.title}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="property">{t("fieldProperty")}</Label>
                      <Select
                        value={dialog.formData.propertyId}
                        onValueChange={(val) => dialog.updateFormData({ propertyId: val })}
                      >
                        <SelectTrigger
                          id="property"
                          className={dialog.formErrors.propertyId ? "border-red-500" : ""}
                        >
                          <SelectValue placeholder={t("selectProperty")} />
                        </SelectTrigger>
                        <SelectContent>
                          {properties.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {dialog.formErrors.propertyId && (
                        <p className="text-sm text-destructive">{dialog.formErrors.propertyId}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="priority">{t("priority")}</Label>
                      <Select
                        value={dialog.formData.priority}
                        onValueChange={(val) =>
                          dialog.updateFormData({
                            priority: val as MaintenancePriority,
                          })
                        }
                      >
                        <SelectTrigger id="priority">
                          <SelectValue placeholder={t("priority")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">{t("low")}</SelectItem>
                          <SelectItem value="medium">{t("medium")}</SelectItem>
                          <SelectItem value="high">{t("high")}</SelectItem>
                          <SelectItem value="urgent">{t("urgent")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">{t("category")}</Label>
                    <Select
                      value={dialog.formData.category ?? ""}
                      onValueChange={(val) =>
                        dialog.updateFormData({
                          category: (val as MaintenanceFormData["category"]) || undefined,
                        })
                      }
                    >
                      <SelectTrigger id="category">
                        <SelectValue placeholder={t("selectCategory")} />
                      </SelectTrigger>
                      <SelectContent>
                        {MAINTENANCE_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">{t("fieldDescription")}</Label>
                    <Textarea
                      id="description"
                      value={dialog.formData.description}
                      onChange={(e) => dialog.updateFormData({ description: e.target.value })}
                      className={dialog.formErrors.description ? "border-red-500" : ""}
                      placeholder={t("descriptionPlaceholder")}
                      rows={4}
                    />
                    {dialog.formErrors.description && (
                      <p className="text-sm text-destructive">{dialog.formErrors.description}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="vendorName">{t("vendorContractor")}</Label>
                      <Input
                        id="vendorName"
                        value={dialog.formData.vendorName || ""}
                        onChange={(e) =>
                          dialog.updateFormData({ vendorName: e.target.value || undefined })
                        }
                        placeholder={t("vendorPlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vendorPhone">{t("vendorPhone")}</Label>
                      <Input
                        id="vendorPhone"
                        value={dialog.formData.vendorPhone || ""}
                        onChange={(e) =>
                          dialog.updateFormData({ vendorPhone: e.target.value || undefined })
                        }
                        placeholder="+351 912 345 678"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="estimatedCost">Estimated Cost ({currencySymbol})</Label>
                      <Input
                        id="estimatedCost"
                        type="number"
                        min="0"
                        step="0.01"
                        value={dialog.formData.estimatedCost ?? ""}
                        onChange={(e) =>
                          dialog.updateFormData({
                            estimatedCost: e.target.value ? parseFloat(e.target.value) : undefined,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoiceRef">{t("invoiceRef")}</Label>
                      <Input
                        id="invoiceRef"
                        value={dialog.formData.invoiceRef || ""}
                        onChange={(e) =>
                          dialog.updateFormData({ invoiceRef: e.target.value || undefined })
                        }
                        placeholder="INV-0001"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="scheduledDate">{t("scheduledDate")}</Label>
                      <Input
                        id="scheduledDate"
                        type="date"
                        value={dialog.formData.scheduledDate || ""}
                        onChange={(e) =>
                          dialog.updateFormData({ scheduledDate: e.target.value || undefined })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueDate">{t("dueDate")}</Label>
                      <Input
                        id="dueDate"
                        type="date"
                        value={dialog.formData.dueDate || ""}
                        onChange={(e) =>
                          dialog.updateFormData({ dueDate: e.target.value || undefined })
                        }
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={dialog.closeDialog}>
                      Cancel
                    </Button>
                    <Button type="submit" loading={dialog.isSubmitting}>
                      {dialog.editingItem ? t("updateTicket") : t("createTicket")}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </PageHeader>

          {/* One merged stat row (CLAUDE.md declutter rule 2) — Open / Urgent /
              Scheduled inspections / Evidence required. */}
          {maintenance.length > 0 && <OperationsKpiRow tickets={maintenance} />}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsMobileSelect
              className="md:hidden"
              value={activeTab}
              onValueChange={setActiveTab}
              aria-label={t("operationsTitle")}
              items={[
                { value: "queue", label: t("tabs.queue") },
                { value: "calendar", label: t("tabs.calendar") },
                { value: "contractors", label: t("tabs.contractors") },
                { value: "evidence", label: t("tabs.evidence") },
              ]}
            />
            <TabsList className="overflow-x-auto max-md:hidden">
              <TabsTrigger value="queue" className="flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5" />
                {t("tabs.queue")}
              </TabsTrigger>
              <TabsTrigger value="calendar" className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {t("tabs.calendar")}
              </TabsTrigger>
              <TabsTrigger value="contractors" className="flex items-center gap-1.5">
                <WrenchIcon className="h-3.5 w-3.5" />
                {t("tabs.contractors")}
              </TabsTrigger>
              <TabsTrigger value="evidence" className="flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                {t("tabs.evidence")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="calendar" className="mt-0">
              <OperationsCalendar tickets={maintenance} onTicketClick={openTicketDetail} />
            </TabsContent>

            <TabsContent value="contractors" className="mt-0">
              <ContactsView />
            </TabsContent>

            <TabsContent value="evidence" className="mt-0">
              <OperationsEvidence
                tickets={maintenance}
                onToggleRequired={handleToggleEvidenceRequired}
                onTicketClick={openTicketDetail}
              />
            </TabsContent>

            <TabsContent value="queue" className="mt-0 space-y-6">
              {/* Search, filters and the result count share one utility row. The count used to
                  sit in a band of its own between the filters and the list — a third strip of
                  chrome to say a number that belongs beside the control that changes it. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SearchFilter
                  className="flex-1"
                  searchPlaceholder={t("searchPlaceholder")}
                  onSearchChange={setSearchQuery}
                  onFilterChange={(key, value) => {
                    if (key === "status") setStatusFilter(value);
                    if (key === "priority") setPriorityFilter(value);
                    if (key === "category") setCategoryFilter(value);
                  }}
                  filters={[
                    {
                      key: "status",
                      label: t("fieldStatus"),
                      options: [
                        { label: t("allStatuses"), value: "all" },
                        { label: t("statusOpen"), value: "open" },
                        { label: t("statusInProgress"), value: "in_progress" },
                        { label: t("statusResolved"), value: "resolved" },
                        { label: t("statusClosed"), value: "closed" },
                      ],
                      defaultValue: "all",
                    },
                    {
                      key: "priority",
                      label: t("priority"),
                      options: [
                        { label: t("allPriorities"), value: "all" },
                        { label: t("low"), value: "low" },
                        { label: t("medium"), value: "medium" },
                        { label: t("high"), value: "high" },
                        { label: t("urgent"), value: "urgent" },
                      ],
                      defaultValue: "all",
                    },
                    {
                      key: "category",
                      label: t("category"),
                      options: [
                        { label: t("allCategories"), value: "all" },
                        ...MAINTENANCE_CATEGORIES.map((cat) => ({
                          label: cat.charAt(0).toUpperCase() + cat.slice(1),
                          value: cat,
                        })),
                      ],
                      defaultValue: "all",
                    },
                  ]}
                />

                {/* Count matches what the list below actually shows (any status, per the Status
                    filter) — "Est. cost" stays scoped to open/in-progress work, so its label
                    says so explicitly. */}
                {filteredTickets.length > 0 && (
                  <p className="shrink-0 text-sm text-[var(--color-muted-foreground)]">
                    <span className="font-medium text-[var(--color-foreground)]">
                      {filteredTickets.length}
                    </span>{" "}
                    {t("ticketCountLabel", { count: filteredTickets.length })}
                    {costSummary.withCost > 0 && (
                      <>
                        {" · "}
                        {t("estCostOpen")}{" "}
                        <span className="font-medium text-[var(--color-foreground)]">
                          {formatCurrency(costSummary.total)}
                        </span>
                        {costSummary.withCost < costSummary.count && (
                          <span className="ml-1 text-xs">
                            {t("withoutEstimate", {
                              count: costSummary.count - costSummary.withCost,
                            })}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                )}
              </div>

              {filteredTickets.length === 0 ? (
                <EmptyStateIllustration
                  type={maintenance.length === 0 ? "maintenance" : "generic"}
                  title={maintenance.length === 0 ? undefined : t("emptyFiltered")}
                  description={maintenance.length === 0 ? undefined : t("emptyFilteredHint")}
                  onAction={maintenance.length === 0 ? dialog.openDialog : undefined}
                />
              ) : (
                <RenderTable
                  data={sortedTickets}
                  rowKey={(ticket) => ticket.id}
                  onRowClick={openTicketDetail}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
                  cardMode
                  renderCard={(ticket) => (
                    <TicketCard
                      ticket={ticket}
                      onOpen={() => openTicketDetail(ticket)}
                      actions={renderTicketActions(ticket)}
                      priorityLabel={t(ticket.priority)}
                      priorityClass={getPriorityColor(ticket.priority)}
                      statusLabel={t(STATUS_LABEL_KEY[ticket.status])}
                      statusIcon={getStatusIcon(ticket.status)}
                      propertyLabel={ticket.propertyName || t("unknown")}
                      createdLabel={t("fieldCreated")}
                      vendorLabel={t("fieldVendor")}
                      scheduledLabel={t("fieldScheduled")}
                    />
                  )}
                  columns={[
                    {
                      key: "title",
                      header: (
                        <SortableHeader
                          sortKey="title"
                          label={t("fieldTitle")}
                          currentSort={getSortDirection("title")}
                          onSort={(key) => requestSort(key as keyof MaintenanceTicket)}
                        />
                      ),
                      cell: (ticket) => ticket.title,
                      cellClassName: "text-sm font-medium text-[var(--color-foreground)]",
                    },
                    {
                      key: "property",
                      header: t("fieldProperty"),
                      cell: (ticket) => ticket.propertyName || t("unknown"),
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "priority",
                      header: (
                        <SortableHeader
                          sortKey="priority"
                          label={t("priority")}
                          currentSort={getSortDirection("priority")}
                          onSort={(key) => requestSort(key as keyof MaintenanceTicket)}
                        />
                      ),
                      cell: (ticket) => (
                        <Badge variant="outline" className={getPriorityColor(ticket.priority)}>
                          {t(ticket.priority)}
                        </Badge>
                      ),
                    },
                    {
                      key: "status",
                      header: (
                        <SortableHeader
                          sortKey="status"
                          label={t("fieldStatus")}
                          currentSort={getSortDirection("status")}
                          onSort={(key) => requestSort(key as keyof MaintenanceTicket)}
                        />
                      ),
                      cell: (ticket) => (
                        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                          {getStatusIcon(ticket.status)}
                          <span>{t(STATUS_LABEL_KEY[ticket.status])}</span>
                        </div>
                      ),
                    },
                    {
                      key: "created",
                      header: t("fieldCreated"),
                      cell: (ticket) => (
                        <div className="flex items-center gap-1">
                          {ticket.isTenantReport && (
                            <User className="h-3.5 w-3.5 text-[var(--color-info)]" />
                          )}
                          {formatDate(ticket.createdAt, locale)}
                        </div>
                      ),
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "vendor",
                      header: t("fieldVendor"),
                      cell: (ticket) => ticket.vendorName || ticket.assignedTo || "—",
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "scheduled",
                      header: t("fieldScheduled"),
                      cell: (ticket) =>
                        ticket.scheduledDate ? formatDate(ticket.scheduledDate, locale) : "—",
                      cellClassName: "text-sm text-[var(--color-muted-foreground)]",
                    },
                    {
                      key: "actions",
                      header: "",
                      headerClassName: "w-10",
                      cell: (ticket) => renderTicketActions(ticket),
                    },
                  ]}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
      <TicketDetailModal
        ticket={selectedTicket}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onEdit={(ticket) => {
          setIsDetailOpen(false);
          handleEdit(ticket);
        }}
        onDelete={() => setIsDetailOpen(false)}
      />
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}
