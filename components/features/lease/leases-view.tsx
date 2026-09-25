"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  FileText,
  Plus,
  Home,
  User,
  DollarSign,
  FileCheck,
  Upload,
  Calendar,
  Building2,
  Edit,
  Trash2,
  Download,
  MoreHorizontal,
  Clock,
  TrendingUp,
  Mail,
} from "lucide-react";
import { SortableHeader } from "@/components/ui/sortable-header";
import { DataViewToggle, DataViewMode } from "@/components/ui/data-view-toggle";
import { RenderTable } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/utils";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { SearchFilter } from "@/components/ui/search-filter";
import { ExportButton } from "@/components/ui/export-button";
import { useApp } from "@/lib/contexts/app-context";
import { RelationshipBadge, daysUntil } from "@/components/shared/relationship-badge";
import { Lease } from "@/lib/types";
import { leaseSchema, type LeaseFormData } from "@/lib/schemas/lease.schema";
import { useToast } from "@/lib/contexts/toast-context";
import { wasReported } from "@/lib/utils/api-error";
import { downloadContract, uploadContract } from "./lease-contract";
import { MAX_CONTRACT_BYTES, MAX_CONTRACT_MB } from "@/lib/utils/contract-file";
import { LeasePartiesEditor, leasePartiesInvalid } from "./lease-parties-editor";
import { useMultiStepForm, StepConfig } from "@/lib/hooks/use-multi-step-form";
import {
  MultiStepFormContainer,
  StepContent,
  DraftBanner,
  MultiStepFormStep,
} from "@/components/ui/multi-step-form";
import { useSortableData } from "@/lib/hooks/use-sortable-data";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";

export type LeasesViewProps = Record<string, never>;

export function LeasesView(): React.ReactElement {
  const { state, addLease, updateLease, deleteLease, refreshData } = useApp();
  const { properties, tenants, leases, loading } = state;
  const { success, error } = useToast();
  const { formatCurrency, currencySymbol } = useCurrency();
  const confirmDialog = useConfirmDialog();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("leases");
  const openLeaseOverlay = (leaseId: string) => {
    router.push(withEntityDetail(pathname, searchParams.toString(), "lease", leaseId));
  };
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingLease, setEditingLease] = useState<Lease | null>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Bulk selection state
  const [selectedLeaseIds, setSelectedLeaseIds] = useState<Set<string>>(new Set());
  const [bulkIncreaseOpen, setBulkIncreaseOpen] = useState(false);
  const [bulkPct, setBulkPct] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);

  // Data view mode state with localStorage persistence
  const [dataViewMode, setDataViewMode] = useState<DataViewMode>("grid");
  useEffect(() => {
    const saved = localStorage.getItem("situs-leases-view-mode");
    if (saved === "grid" || saved === "table") setDataViewMode(saved);
  }, []);
  const handleViewModeChange = useCallback((mode: DataViewMode) => {
    setDataViewMode(mode);
    localStorage.setItem("situs-leases-view-mode", mode);
  }, []);

  const initialFormData: LeaseFormData = {
    propertyId: "",
    tenantId: "",
    startDate: "",
    endDate: "",
    monthlyRent: 0,
    deposit: 0,
    autoRenew: false,
    renewalNoticeDays: 60,
    status: "draft" as const,
    notes: "",
    atContractNumber: "",
    parties: [],
  };

  // Multi-step form configuration
  const steps: StepConfig<LeaseFormData>[] = [
    {
      id: "property",
      title: t("step.propertyTitle"),
      description: t("step.propertyDescription"),
      fields: ["propertyId"],
    },
    {
      id: "tenant",
      title: t("step.tenantTitle"),
      description: t("step.tenantDescription"),
      fields: ["tenantId", "parties"],
      // Checked here, not only by the schema at the end, so "Continue" can say what is wrong in
      // the user's language.
      validate: (data) =>
        leasePartiesInvalid(data.parties) ? { parties: t("parties.invalid") } : null,
    },
    {
      id: "terms",
      title: t("step.termsTitle"),
      description: t("step.termsDescription"),
      fields: ["startDate", "endDate", "monthlyRent", "deposit", "autoRenew", "renewalNoticeDays"],
    },
    {
      id: "notes",
      title: t("step.notesTitle"),
      description: t("step.notesDescription"),
      fields: ["notes", "atContractNumber", "atContractVersion"],
      validate: (data) =>
        /^\d*$/.test(data.atContractNumber ?? "")
          ? null
          : { atContractNumber: t("atContract.invalid") },
    },
  ];

  const wizardSteps: MultiStepFormStep[] = [
    { id: "property", title: t("step.shortProperty"), icon: <Home className="h-4 w-4" /> },
    { id: "tenant", title: t("step.shortTenant"), icon: <User className="h-4 w-4" /> },
    { id: "terms", title: t("step.shortTerms"), icon: <DollarSign className="h-4 w-4" /> },
    {
      id: "notes",
      title: t("step.shortNotes"),
      icon: <FileCheck className="h-4 w-4" />,
    },
  ];

  const wizard = useMultiStepForm<LeaseFormData>({
    steps,
    schema: leaseSchema,
    initialData: initialFormData,
    onComplete: async (data) => {
      // Only a new lease starts active. An edit sends no status, so the lease keeps its own:
      // stamping "active" on every save brought an ended lease back to life whenever anyone
      // corrected a date or a note on it. (Renewing reaches this as an edit of an active lease.)
      const { status: _formStatus, ...terms } = data;

      let saved: Lease;
      if (editingLease) {
        saved = await updateLease(editingLease.id, terms);
        success(t("toast.updated"));
      } else {
        saved = await addLease({ ...terms, status: "active" as const });
        success(t("toast.created"));
      }

      // The PDF goes to the contract's own route once the lease exists, as the file itself.
      if (contractFile) {
        try {
          await uploadContract(saved.id, contractFile);
          await refreshData();
        } catch {
          error(t("toast.contractUploadFailed"));
        }
      }

      setWizardOpen(false);
      setEditingLease(null);
      setContractFile(null);
      wizard.resetForm();
    },
    persistence: {
      key: "lease-wizard-draft",
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      // Co-tenants' and guarantors' NIFs and documents: encrypted on the server, so not left
      // in clear in the browser.
      omit: ["parties"],
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">{t("active")}</Badge>;
      case "expired":
        return <Badge variant="destructive">{t("expired")}</Badge>;
      case "terminated":
        return <Badge variant="secondary">{t("terminated")}</Badge>;
      case "pending":
        return <Badge variant="default">{t("pending")}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // The contract route's limit, so the form refuses what the server would.
      if (file.size > MAX_CONTRACT_BYTES) {
        error(t("toast.fileTooLarge", { size: MAX_CONTRACT_MB }));
        return;
      }
      // Validate file type
      if (file.type !== "application/pdf") {
        error(t("toast.pdfOnly"));
        return;
      }
      setContractFile(file);
    }
  };

  const handleEdit = (lease: Lease) => {
    setEditingLease(lease);
    wizard.updateFormData({
      propertyId: lease.propertyId,
      tenantId: lease.tenantId,
      startDate: lease.startDate.split("T")[0],
      endDate: lease.endDate.split("T")[0],
      monthlyRent: lease.monthlyRent,
      deposit: lease.deposit,
      autoRenew: lease.autoRenew,
      renewalNoticeDays: lease.renewalNoticeDays,
      notes: lease.notes || "",
      atContractNumber: lease.atContractNumber ?? "",
      atContractVersion: lease.atContractVersion ?? null,
      parties: (lease.parties ?? []).map((party) => ({
        role: party.role,
        name: party.name,
        taxId: party.taxId ?? "",
        taxCountry: party.taxCountry ?? "PT",
        idDocument: party.idDocument ?? "",
      })),
    });
    setContractFile(null);
    setWizardOpen(true);
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

  // Open the wizard from a link elsewhere:
  // - `?action=edit|renew&id=X` (lease detail, tenant modal) edits lease X;
  // - `?action=create&tenantId=Y` is the tenant modal's "Add lease". It starts a new lease with
  //   that tenant chosen, and their property when they have one. This case was never handled, so
  //   the button landed on the list and did nothing.
  useEffect(() => {
    const action = searchParams.get("action");
    if (!action || loading) return;
    if (action === "create") {
      const tenant = tenants.find((t) => t.id === searchParams.get("tenantId"));
      setEditingLease(null);
      wizard.updateFormData({ tenantId: tenant?.id ?? "", propertyId: tenant?.propertyId ?? "" });
      setContractFile(null);
      setWizardOpen(true);
    } else if (action === "edit" || action === "renew") {
      const target = leases.find((l) => l.id === searchParams.get("id"));
      if (!target) return;
      handleEdit(target);
    } else {
      return;
    }
    // Clear the query params after opening
    router.replace("/leases");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4",
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
          className="min-w-0 flex-1 text-left"
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
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-[var(--color-muted-foreground)]">{t("field.monthlyRent")}</dt>
          <dd className="font-medium text-[var(--color-foreground)]">
            {formatCurrency(lease.monthlyRent)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-muted-foreground)]">{t("field.period")}</dt>
          <dd className="text-[var(--color-muted-foreground)]">
            {new Date(lease.startDate).toLocaleDateString(locale)} →{" "}
            {new Date(lease.endDate).toLocaleDateString(locale)}
          </dd>
        </div>
      </dl>
    </div>
  );

  if (loading) {
    return <LoadingState variant="cards" count={6} />;
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader title={t("pageTitle")} description={t("pageDescription")}>
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

          {/* Multi-Step Wizard Dialog */}
          <Dialog
            open={wizardOpen}
            onOpenChange={(open) => {
              setWizardOpen(open);
              if (!open) {
                setEditingLease(null);
                setContractFile(null);
                wizard.resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setWizardOpen(true)} className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                {t("addLease")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[var(--color-foreground)]">
                  {editingLease ? t("dialogEditTitle") : t("dialogCreateTitle")}
                </DialogTitle>
                <DialogDescription>
                  {editingLease ? t("dialogEditDescription") : t("dialogCreateDescription")}
                </DialogDescription>
              </DialogHeader>

              {/* Draft recovery banner */}
              {wizard.hasDraft && !editingLease && (
                <DraftBanner
                  onRestore={() => {
                    // Data is auto-loaded in hook
                  }}
                  onDiscard={() => {
                    wizard.clearDraft();
                    wizard.resetForm();
                  }}
                />
              )}

              {/* Multi-step form */}
              <MultiStepFormContainer
                steps={wizardSteps}
                currentStep={wizard.currentStep}
                completedSteps={wizard.visitedSteps}
                visitedSteps={wizard.visitedSteps}
                progress={wizard.progress}
                isSubmitting={wizard.isSubmitting}
                isFirstStep={wizard.isFirstStep}
                isLastStep={wizard.isLastStep}
                onPrevStep={wizard.prevStep}
                onNextStep={wizard.nextStep}
                onSubmit={wizard.handleSubmit}
                onGoToStep={wizard.goToStep}
                indicatorVariant="pills"
                submitText={editingLease ? t("submitUpdate") : t("submitCreate")}
              >
                {/* Step 1: Property Selection */}
                {wizard.currentStep === 0 && (
                  <StepContent
                    title={t("selectProperty.title")}
                    description={t("selectProperty.description")}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="propertyId">{t("propertyRequired")}</Label>
                      <Select
                        value={wizard.formData.propertyId}
                        onValueChange={(value) => wizard.updateFormData({ propertyId: value })}
                      >
                        <SelectTrigger
                          className={wizard.stepErrors.propertyId ? "border-red-500" : ""}
                        >
                          <SelectValue placeholder={t("selectProperty.placeholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {properties.length === 0 ? (
                            <div className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                              {t("selectProperty.noneAvailable")}
                            </div>
                          ) : (
                            properties.map((property) => (
                              <SelectItem key={property.id} value={property.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{property.name}</span>
                                  <span className="text-xs text-[var(--color-muted-foreground)]">
                                    {property.address}
                                  </span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {properties.length === 0 && (
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4 text-center">
                          <p className="text-sm text-[var(--color-muted-foreground)] mb-2">
                            {t("selectProperty.noneFound")}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push("/portfolio")}
                          >
                            <Plus className="w-4 h-4 mr-2" /> {t("goToPortfolio")}
                          </Button>
                        </div>
                      )}
                      {wizard.stepErrors.propertyId && (
                        <p className="text-sm text-destructive">{wizard.stepErrors.propertyId}</p>
                      )}
                    </div>
                  </StepContent>
                )}

                {/* Step 2: Tenant Selection */}
                {wizard.currentStep === 1 && (
                  <StepContent
                    title={t("selectTenant.title")}
                    description={t("selectTenant.description")}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="tenantId">{t("tenantRequired")}</Label>
                      <Select
                        value={wizard.formData.tenantId}
                        onValueChange={(value) => wizard.updateFormData({ tenantId: value })}
                      >
                        <SelectTrigger
                          className={wizard.stepErrors.tenantId ? "border-red-500" : ""}
                        >
                          <SelectValue placeholder={t("selectTenant.placeholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {tenants.length === 0 ? (
                            <div className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                              {t("selectTenant.noneAvailable")}
                            </div>
                          ) : (
                            tenants.map((tenant) => (
                              <SelectItem key={tenant.id} value={tenant.id}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{tenant.name}</span>
                                  <span className="text-xs text-[var(--color-muted-foreground)]">
                                    {tenant.email}
                                  </span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {tenants.length === 0 && (
                        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4 text-center">
                          <p className="text-sm text-[var(--color-muted-foreground)] mb-2">
                            {t("selectTenant.noneFound")}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push("/people")}
                          >
                            <Plus className="w-4 h-4 mr-2" /> {t("goToPeople")}
                          </Button>
                        </div>
                      )}
                      {wizard.stepErrors.tenantId && (
                        <p className="text-sm text-destructive">{wizard.stepErrors.tenantId}</p>
                      )}
                    </div>

                    <LeasePartiesEditor
                      parties={wizard.formData.parties ?? []}
                      onChange={(parties) => wizard.updateFormData({ parties })}
                      // The step's own check says this in the user's language; the schema's
                      // English, which the final submit would add, is never shown.
                      error={wizard.stepErrors.parties ? t("parties.invalid") : undefined}
                    />
                  </StepContent>
                )}

                {/* Step 3: Lease Terms */}
                {wizard.currentStep === 2 && (
                  <StepContent title={t("step.termsTitle")} description={t("termsStepDescription")}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="startDate">{t("startDateRequired")}</Label>
                        <Input
                          id="startDate"
                          type="date"
                          value={wizard.formData.startDate}
                          onChange={(e) =>
                            wizard.updateFormData({
                              startDate: e.target.value,
                            })
                          }
                          className={wizard.stepErrors.startDate ? "border-red-500" : ""}
                        />
                        {wizard.stepErrors.startDate && (
                          <p className="text-sm text-destructive">{wizard.stepErrors.startDate}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="endDate">{t("endDateRequired")}</Label>
                        <Input
                          id="endDate"
                          type="date"
                          value={wizard.formData.endDate}
                          onChange={(e) => wizard.updateFormData({ endDate: e.target.value })}
                          className={wizard.stepErrors.endDate ? "border-red-500" : ""}
                        />
                        {wizard.stepErrors.endDate && (
                          <p className="text-sm text-destructive">{wizard.stepErrors.endDate}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="monthlyRent">
                          {t("monthlyRentRequired", { symbol: currencySymbol })}
                        </Label>
                        <Input
                          id="monthlyRent"
                          type="number"
                          min="0"
                          step="0.01"
                          value={wizard.formData.monthlyRent}
                          onChange={(e) =>
                            wizard.updateFormData({
                              monthlyRent: parseFloat(e.target.value) || 0,
                            })
                          }
                          className={wizard.stepErrors.monthlyRent ? "border-red-500" : ""}
                        />
                        {wizard.stepErrors.monthlyRent && (
                          <p className="text-sm text-destructive">
                            {wizard.stepErrors.monthlyRent}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="deposit">
                          {t("depositRequired", { symbol: currencySymbol })}
                        </Label>
                        <Input
                          id="deposit"
                          type="number"
                          min="0"
                          step="0.01"
                          value={wizard.formData.deposit}
                          onChange={(e) =>
                            wizard.updateFormData({
                              deposit: parseFloat(e.target.value) || 0,
                            })
                          }
                          className={wizard.stepErrors.deposit ? "border-red-500" : ""}
                        />
                        {wizard.stepErrors.deposit && (
                          <p className="text-sm text-destructive">{wizard.stepErrors.deposit}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="renewalNoticeDays">{t("field.renewalNoticeDays")}</Label>
                        <Input
                          id="renewalNoticeDays"
                          type="number"
                          min="0"
                          value={wizard.formData.renewalNoticeDays}
                          onChange={(e) =>
                            wizard.updateFormData({
                              renewalNoticeDays: parseInt(e.target.value) || 60,
                            })
                          }
                        />
                      </div>
                    </div>
                  </StepContent>
                )}

                {/* Step 4: Documents & Notes */}
                {wizard.currentStep === 3 && (
                  <StepContent title={t("docsStepTitle")} description={t("docsStepDescription")}>
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="atContractNumber">{t("atContract.number")}</Label>
                          <Input
                            id="atContractNumber"
                            inputMode="numeric"
                            maxLength={20}
                            value={wizard.formData.atContractNumber ?? ""}
                            onChange={(e) =>
                              wizard.updateFormData({ atContractNumber: e.target.value.trim() })
                            }
                            aria-invalid={!!wizard.stepErrors.atContractNumber}
                            className={
                              wizard.stepErrors.atContractNumber ? "border-destructive" : ""
                            }
                          />
                          {wizard.stepErrors.atContractNumber && (
                            <p className="text-sm text-destructive">{t("atContract.invalid")}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="atContractVersion">{t("atContract.version")}</Label>
                          <Input
                            id="atContractVersion"
                            type="number"
                            min="1"
                            max="999"
                            value={wizard.formData.atContractVersion ?? ""}
                            onChange={(e) => {
                              const version = parseInt(e.target.value, 10);
                              wizard.updateFormData({
                                atContractVersion: Number.isNaN(version) ? null : version,
                              });
                            }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t("atContract.hint")}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="contractFile">{t("contractPdf")}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="contractFile"
                          type="file"
                          accept=".pdf"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                        <Label
                          htmlFor="contractFile"
                          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-secondary)] border border-[var(--color-border)] rounded-md cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
                        >
                          <Upload className="w-4 h-4" />
                          {contractFile ? contractFile.name : t("choosePdf")}
                        </Label>
                        {contractFile && (
                          <span className="text-sm text-[var(--color-muted-foreground)]">
                            {(contractFile.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t("maxFileSize", { size: MAX_CONTRACT_MB })}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="notes">{t("additionalNotes")}</Label>
                      <Textarea
                        id="notes"
                        value={wizard.formData.notes}
                        onChange={(e) => wizard.updateFormData({ notes: e.target.value })}
                        placeholder={t("notesPlaceholder")}
                        rows={6}
                        className={wizard.stepErrors.notes ? "border-red-500" : ""}
                      />
                      {wizard.stepErrors.notes && (
                        <p className="text-sm text-destructive">{wizard.stepErrors.notes}</p>
                      )}
                    </div>
                  </StepContent>
                )}
              </MultiStepFormContainer>
            </DialogContent>
          </Dialog>
        </PageHeader>

        {/* Search and Filter */}
        <SearchFilter
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

        <div className="flex items-center justify-end">
          <DataViewToggle mode={dataViewMode} onChange={handleViewModeChange} />
        </div>

        {expiringSoon.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">
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

        {dataViewMode === "table" ? (
          /* Table View */
          filteredLeases.length === 0 ? (
            leases.length === 0 && (properties.length === 0 || tenants.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="h-12 w-12 text-[var(--color-muted-foreground)] mb-4" />
                <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
                  {t("emptyTitle")}
                </h3>
                <p className="text-sm text-[var(--color-muted-foreground)] mb-6 max-w-md">
                  {t("emptyDescription")}
                </p>
                <div className="flex items-center gap-3">
                  {properties.length === 0 && (
                    <Button variant="outline" size="sm" onClick={() => router.push("/portfolio")}>
                      <Plus className="w-4 h-4 mr-2" /> {t("createProperty")}
                    </Button>
                  )}
                  {tenants.length === 0 && (
                    <Button variant="outline" size="sm" onClick={() => router.push("/people")}>
                      <Plus className="w-4 h-4 mr-2" /> {t("createPerson")}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <EmptyStateIllustration
                type={leases.length === 0 ? "leases" : "generic"}
                title={leases.length === 0 ? undefined : t("noneFound")}
                description={leases.length === 0 ? undefined : t("adjustFilters")}
                onAction={leases.length === 0 ? () => setWizardOpen(true) : undefined}
                actionLabel={leases.length === 0 ? t("addFirst") : undefined}
              />
            )
          ) : (
            <>
              {/* Bulk actions bar */}
              {selectedLeaseIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--color-info-muted)] border border-[var(--color-info)]/30 rounded-lg">
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
                            <div className="rounded-md bg-[var(--color-card)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] text-sm max-h-48 overflow-y-auto">
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
                                    <span className="text-green-400 font-medium">
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
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]"
              />
            </>
          )
        ) : (
          <>
            {/* Sortable Column Headers */}
            {filteredLeases.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-2 bg-[var(--color-surface-hover)] rounded-lg border border-[var(--color-border)]">
                <div className="flex-1">
                  <SortableHeader
                    sortKey="startDate"
                    label={t("field.startDate")}
                    currentSort={getSortDirection("startDate")}
                    onSort={(key) => requestSort(key as keyof Lease)}
                  />
                </div>
                <div className="w-32">
                  <SortableHeader
                    sortKey="monthlyRent"
                    label={t("field.rent")}
                    currentSort={getSortDirection("monthlyRent")}
                    onSort={(key) => requestSort(key as keyof Lease)}
                  />
                </div>
                <div className="w-32">
                  <SortableHeader
                    sortKey="status"
                    label={t("field.status")}
                    currentSort={getSortDirection("status")}
                    onSort={(key) => requestSort(key as keyof Lease)}
                  />
                </div>
              </div>
            )}

            {/* Leases List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredLeases.length === 0 ? (
                <div className="col-span-full">
                  {leases.length === 0 && (properties.length === 0 || tenants.length === 0) ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <FileText className="h-12 w-12 text-[var(--color-muted-foreground)] mb-4" />
                      <h3 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
                        {t("emptyTitle")}
                      </h3>
                      <p className="text-sm text-[var(--color-muted-foreground)] mb-6 max-w-md">
                        {t("emptyDescription")}
                      </p>
                      <div className="flex items-center gap-3">
                        {properties.length === 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push("/portfolio")}
                          >
                            <Plus className="w-4 h-4 mr-2" /> {t("createProperty")}
                          </Button>
                        )}
                        {tenants.length === 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push("/people")}
                          >
                            <Plus className="w-4 h-4 mr-2" /> {t("createPerson")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <EmptyStateIllustration
                      type={leases.length === 0 ? "leases" : "generic"}
                      title={leases.length === 0 ? undefined : t("noneFound")}
                      description={leases.length === 0 ? undefined : t("adjustFilters")}
                      onAction={leases.length === 0 ? () => setWizardOpen(true) : undefined}
                      actionLabel={leases.length === 0 ? t("addFirst") : undefined}
                    />
                  )}
                </div>
              ) : (
                sortedLeases.map((lease: Lease) => (
                  <Card
                    key={lease.id}
                    className="overflow-hidden transition-all hover:shadow-lg cursor-pointer"
                    onClick={() => openLeaseOverlay(lease.id)}
                  >
                    <div className="aspect-video w-full bg-[var(--color-secondary)] relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <FileText className="h-16 w-16 text-[var(--color-muted-foreground)]" />
                      </div>
                      <div className="absolute top-3 right-3">{getStatusBadge(lease.status)}</div>
                    </div>
                    <CardHeader>
                      <CardTitle className="text-[var(--color-foreground)] flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {lease.tenant?.name}
                      </CardTitle>
                      <CardDescription className="flex items-start gap-1">
                        <Building2 className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="text-xs">{lease.property?.name}</span>
                      </CardDescription>
                      {/* Relationship badges */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(() => {
                          const days = lease.endDate ? daysUntil(lease.endDate) : null;
                          if (days !== null && days <= 30 && days >= 0) {
                            return (
                              <RelationshipBadge
                                variant="expiry"
                                label={t("daysToExpiry", { days })}
                              />
                            );
                          }
                          if (days !== null && days < 0) {
                            return <RelationshipBadge variant="overdue" label={t("expired")} />;
                          }
                          return null;
                        })()}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--color-muted-foreground)]">
                          {t("field.rent")}
                        </span>
                        <span className="font-semibold text-[var(--color-foreground)]">
                          {t("perMonth", { amount: formatCurrency(lease.monthlyRent) })}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-[var(--color-muted-foreground)]">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>{new Date(lease.startDate).toLocaleDateString(locale)}</span>
                        </div>
                        <span>{t("dateTo")}</span>
                        <span>{new Date(lease.endDate).toLocaleDateString(locale)}</span>
                      </div>
                      {lease.contractFileName && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[var(--color-muted-foreground)]">
                            {t("field.contract")}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadContract(lease);
                            }}
                            className="flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            {t("download")}
                          </Button>
                        </div>
                      )}
                      <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="flex items-center gap-1">
                              <MoreHorizontal className="w-4 h-4" />
                              {t("field.actions")}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(lease)}>
                              <Edit className="h-4 w-4 mr-2" />
                              {t("editLease")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(lease.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("deleteLease")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}
