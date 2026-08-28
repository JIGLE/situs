"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
  ExternalLink,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils/utils";
import { apiFetch } from "@/lib/utils/api-client";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Tabs, TabsContent, TabsList, TabsMobileSelect, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/lib/contexts/app-context";
import { useTabPersistence } from "@/lib/hooks/use-tab-persistence";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import { EntityLink } from "@/components/shared/entity-link";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import {
  expenseSchema,
  EXPENSE_CATEGORIES,
  type ExpenseFormData,
} from "@/lib/schemas/expense.schema";
import { receiptSchema, type ReceiptFormData } from "@/lib/schemas/receipt.schema";
import { tenantSchema, type TenantFormData } from "@/lib/schemas/tenant.schema";
import { usePropertyActivity } from "@/lib/hooks/use-property-activity";
import { AuditTrail } from "@/components/shared/audit-trail";
import { PropertyFormDialog, type PropertyFormDialogRef } from "./property-form-dialog";
import { PropertyYearStrip, type YearStripSelection } from "./property-year-strip";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { DocumentsView } from "@/components/features/document/documents-view";

/** The slice of `Document` this view needs — enough to list and group by type. */
interface PropertyDocument {
  id: string;
  name: string;
  type: string;
  createdAt?: string;
  fileSize?: number;
}

interface PropertyDetailViewProps {
  propertyId: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  occupied: "default",
  vacant: "secondary",
  maintenance: "destructive",
};

export function PropertyDetailView({ propertyId }: PropertyDetailViewProps) {
  const { state, refreshData, addExpense, addReceipt, addTenant } = useApp();
  const { formatCurrency } = useCurrency();
  const router = useRouter();
  const locale = useLocale();
  const [activeTab, setActiveTab] = useTabPersistence("property-detail", "overview");
  const t = useTranslations("propertyDetail");
  const tFin = useTranslations("financial");
  const tDoc = useTranslations("documents");

  /**
   * DocumentType is snake_case in the schema (`floor_plan`) but camelCase in the catalog
   * (`documents.floorPlan`), so bridge the two and fall back to a humanised label for any
   * type without a translation.
   */
  const documentTypeLabel = (raw: string): string => {
    const key = raw.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
    const label = tDoc(key);
    return label.endsWith(key) ? raw.replace(/_/g, " ") : label;
  };

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
    const key = `categories.${raw.toLowerCase().replace(/\s+/g, "_")}`;
    const label = tFin(key);
    // On a miss next-intl renders the full key path, so detect that rather than testing for
    // undefined. Normalisation resolves the seeded categories ("Repairs" -> repairs,
    // "Mortgage Interest" -> mortgage_interest); this only catches genuinely unknown ones.
    return label.endsWith(key) ? raw : label;
  };
  // (no debug logs in production view)

  // Ownership assignment state
  const { token: csrfToken } = useCsrf();
  const [ownerAssignOwnerId, setOwnerAssignOwnerId] = useState("");
  const [ownerAssignPct, setOwnerAssignPct] = useState<number | "">("");
  const [ownerAssignError, setOwnerAssignError] = useState("");
  const [ownerAssignSaving, setOwnerAssignSaving] = useState(false);

  // Quick-action overlay: Documents still opens in place from the empty-state link below.
  const [documentsOpen, setDocumentsOpen] = useState(false);
  // The reference month whose detail modal is open, set by clicking a year-strip cell.
  const [selectedMonth, setSelectedMonth] = useState<YearStripSelection | null>(null);

  // Documents already tagged to this property. Feeds both the deduction-evidence picker in the
  // Add Expense dialog (Expense.documentId, Migration A) and the Documents tab, which groups
  // them by `type` — so the fetch keeps type/date/size rather than just id and name.
  const [propertyDocuments, setPropertyDocuments] = useState<PropertyDocument[]>([]);
  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    fetch(`/api/documents?propertyId=${propertyId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.data) {
          setPropertyDocuments(
            body.data.map((d: PropertyDocument) => ({
              id: d.id,
              name: d.name,
              type: d.type,
              createdAt: d.createdAt,
              fileSize: d.fileSize,
            })),
          );
        }
      })
      .catch(() => {
        // Document linking is optional — a failed fetch just hides the picker.
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  // Stable initialData and onSubmit for quick-add dialogs (prevents infinite re-render loop)
  const expenseInitialData = useMemo<ExpenseFormData>(
    () => ({
      propertyId,
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      category: "other" as const,
      description: "",
      isDeductible: true,
      documentId: null,
    }),
    [propertyId],
  );

  const handleExpenseSubmit = useCallback(
    async (data: ExpenseFormData) => {
      await addExpense({ ...data, propertyId });
    },
    [addExpense, propertyId],
  );

  const receiptInitialData = useMemo<ReceiptFormData>(
    () => ({
      tenantId: "",
      propertyId,
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      type: "rent",
      status: "paid",
      description: "",
    }),
    [propertyId],
  );

  const handleReceiptSubmit = useCallback(
    async (data: ReceiptFormData) => {
      await addReceipt({ ...data, propertyId });
    },
    [addReceipt, propertyId],
  );

  // Quick-add: Expense dialog (pre-filled with this property)
  const expenseDialog = useFormDialog<ExpenseFormData>({
    schema: expenseSchema,
    initialData: expenseInitialData,
    onSubmit: handleExpenseSubmit,
    successMessage: { create: "Expense recorded!", update: "Expense updated!" },
    errorMessage: "Failed to save expense.",
  });

  // Quick-add: Receipt / payment dialog (pre-filled with this property)
  const receiptDialog = useFormDialog<ReceiptFormData>({
    schema: receiptSchema,
    initialData: receiptInitialData,
    onSubmit: handleReceiptSubmit,
    successMessage: { create: "Payment recorded!", update: "Payment updated!" },
    errorMessage: "Failed to record payment.",
  });

  // Add tenant, in place. This used to deep-link to /people, which meant leaving the property
  // you were working on and landing on a different page with a modal already open over it —
  // disorienting, and it lost the context you started from. Its own dialog keeps you here.
  const tenantInitialData = useMemo<TenantFormData>(
    () => ({
      name: "",
      email: "",
      phone: "",
      propertyId,
      rent: 0,
      leaseStart: "",
      leaseEnd: "",
      paymentStatus: "pending" as const,
    }),
    [propertyId],
  );

  const handleTenantSubmit = useCallback(
    async (data: TenantFormData) => {
      await addTenant({ ...data, propertyId });
    },
    [addTenant, propertyId],
  );

  const tenantDialog = useFormDialog<TenantFormData>({
    schema: tenantSchema,
    initialData: tenantInitialData,
    onSubmit: handleTenantSubmit,
    successMessage: { create: "Tenant added!", update: "Tenant updated!" },
    errorMessage: "Failed to add tenant.",
  });

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
  const relatedMaintenance = useMemo(
    () => state.maintenance.filter((m) => m.propertyId === propertyId),
    [state.maintenance, propertyId],
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

  const totalRevenue = relatedReceipts.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = relatedExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netOperatingIncome = totalRevenue - totalExpenses;
  const openTickets = relatedMaintenance.filter(
    (m) => m.status === "open" || m.status === "in_progress",
  ).length;
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
      setOwnerAssignError(
        err instanceof Error ? err.message : "Failed to assign owner. Please try again.",
      );
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
      setOwnerAssignError(
        err instanceof Error ? err.message : "Failed to remove owner. Please try again.",
      );
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
    const paidReceipts = relatedReceipts
      .filter((r) => r.status === "paid")
      .reduce((sum, r) => sum + r.amount, 0);
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

      {/* Quick-action overlay: Documents — scoped DocumentsView, stays on this page */}
      <Sheet open={documentsOpen} onOpenChange={setDocumentsOpen}>
        <SheetContent side="center" className="p-0">
          <SheetTitle className="sr-only">{t("actions.documents")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("actions.documents")} — {property.name}
          </SheetDescription>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] p-4">
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {t("actions.documents")}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{property.name}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDocumentsOpen(false);
                  router.push(`/documents?propertyId=${property.id}`);
                }}
              >
                {t("actions.openInDocuments")} <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <DocumentsView propertyId={property.id} embedded />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Header */}
      <div className="flex flex-col gap-4 sticky top-0 z-20 bg-[var(--color-card-solid)]/95 backdrop-blur-sm">
        <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start @lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 lg:p-4 bg-[var(--color-info-muted)]">
              <Building2 className="h-8 w-8 lg:h-10 lg:w-10 text-[var(--color-info)]" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-[var(--color-foreground)]">
                {property.name}
              </h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-[var(--color-muted-foreground)]">
                <MapPin className="h-4 w-4" />
                <span>{property.address}</span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant={STATUS_VARIANT[property.status] || "secondary"}>
                  {t(`status.${property.status}`) || property.status}
                </Badge>
                <span className="text-sm text-[var(--color-muted-foreground)] flex items-center gap-1">
                  <Bed className="h-3.5 w-3.5" /> {property.bedrooms}
                </span>
                <span className="text-sm text-[var(--color-muted-foreground)] flex items-center gap-1">
                  <Bath className="h-3.5 w-3.5" /> {property.bathrooms}
                </span>
                <span className="text-sm font-medium">{formatCurrency(property.rent)}/mo</span>
              </div>
            </div>
          </div>
          {/* The header's five-button quick-action bar has gone. Each action now lives where
              its subject does: Edit with the property's own details (Overview), Add Expense and
              the expense/receipt dialogs in Money, Documents as its own tab, and Record Payment
              behind a click on the reference month it applies to. Review Payments is gone
              outright — the Money tab and the Finance section both already list receipts.
              The dialogs stay mounted here so any tab can open them. */}
          <>
            {/* Both dialogs are state-controlled, so they render nothing until opened and need
                no trigger element of their own — the buttons that open them now live in the
                Money tab and the reference-month modal. */}
            <Dialog
              open={expenseDialog.isOpen}
              onOpenChange={(open) => !open && expenseDialog.closeDialog()}
            >
              <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                  <DialogTitle>Record Expense</DialogTitle>
                  <DialogDescription>Log a cost for {property.name}</DialogDescription>
                </DialogHeader>
                <form onSubmit={expenseDialog.handleSubmit} className="space-y-4 pt-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="exp-category">Category</Label>
                      <Select
                        value={expenseDialog.formData.category}
                        onValueChange={(v) =>
                          expenseDialog.updateFormData({
                            category: v as ExpenseFormData["category"],
                          })
                        }
                      >
                        <SelectTrigger id="exp-category">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="exp-amount">Amount</Label>
                      <Input
                        id="exp-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        value={expenseDialog.formData.amount || ""}
                        onChange={(e) =>
                          expenseDialog.updateFormData({ amount: parseFloat(e.target.value) || 0 })
                        }
                        className={
                          expenseDialog.formErrors.amount ? "border-[var(--color-destructive)]" : ""
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="exp-date">Date</Label>
                    <Input
                      id="exp-date"
                      type="date"
                      value={expenseDialog.formData.date}
                      onChange={(e) => expenseDialog.updateFormData({ date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="exp-desc">Description (optional)</Label>
                    <Textarea
                      id="exp-desc"
                      rows={2}
                      placeholder="Notes…"
                      value={expenseDialog.formData.description || ""}
                      onChange={(e) =>
                        expenseDialog.updateFormData({ description: e.target.value })
                      }
                    />
                  </div>
                  {propertyDocuments.length > 0 && (
                    <div className="space-y-1.5">
                      <Label htmlFor="exp-document">Deduction evidence (optional)</Label>
                      <Select
                        value={expenseDialog.formData.documentId ?? "none"}
                        onValueChange={(v) =>
                          expenseDialog.updateFormData({ documentId: v === "none" ? null : v })
                        }
                      >
                        <SelectTrigger id="exp-document">
                          <SelectValue placeholder="Link a document…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No document</SelectItem>
                          {propertyDocuments.map((doc) => (
                            <SelectItem key={doc.id} value={doc.id}>
                              {doc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={expenseDialog.closeDialog}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={expenseDialog.isSubmitting}>
                      Save Expense
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            {/* Quick add: Receipt / payment */}
            <Dialog
              open={receiptDialog.isOpen}
              onOpenChange={(open) => !open && receiptDialog.closeDialog()}
            >
              <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                  <DialogTitle>Record Payment</DialogTitle>
                  <DialogDescription>
                    Log a rent or deposit payment for {property.name}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={receiptDialog.handleSubmit} className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-tenant">Tenant</Label>
                    <Select
                      value={receiptDialog.formData.tenantId}
                      onValueChange={(v) => receiptDialog.updateFormData({ tenantId: v })}
                    >
                      <SelectTrigger
                        id="rec-tenant"
                        className={
                          receiptDialog.formErrors.tenantId
                            ? "border-[var(--color-destructive)]"
                            : ""
                        }
                      >
                        <SelectValue placeholder="Select tenant" />
                      </SelectTrigger>
                      <SelectContent>
                        {relatedTenants.map((ten) => (
                          <SelectItem key={ten.id} value={ten.id}>
                            {ten.name}
                          </SelectItem>
                        ))}
                        {state.tenants
                          .filter((ten) => !relatedTenants.some((rt) => rt.id === ten.id))
                          .map((ten) => (
                            <SelectItem key={ten.id} value={ten.id}>
                              {ten.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {receiptDialog.formErrors.tenantId && (
                      <p className="text-xs text-[var(--color-destructive)]">
                        {receiptDialog.formErrors.tenantId}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-amount">Amount</Label>
                      <Input
                        id="rec-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        value={receiptDialog.formData.amount || ""}
                        onChange={(e) =>
                          receiptDialog.updateFormData({ amount: parseFloat(e.target.value) || 0 })
                        }
                        className={
                          receiptDialog.formErrors.amount ? "border-[var(--color-destructive)]" : ""
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-type">Type</Label>
                      <Select
                        value={receiptDialog.formData.type}
                        onValueChange={(v) =>
                          receiptDialog.updateFormData({ type: v as ReceiptFormData["type"] })
                        }
                      >
                        <SelectTrigger id="rec-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rent">Rent</SelectItem>
                          <SelectItem value="deposit">Deposit</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-date">Date</Label>
                      <Input
                        id="rec-date"
                        type="date"
                        value={receiptDialog.formData.date}
                        onChange={(e) => receiptDialog.updateFormData({ date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-status">Status</Label>
                      <Select
                        value={receiptDialog.formData.status}
                        onValueChange={(v) =>
                          receiptDialog.updateFormData({ status: v as ReceiptFormData["status"] })
                        }
                      >
                        <SelectTrigger id="rec-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={receiptDialog.closeDialog}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={receiptDialog.isSubmitting}>
                      Save Payment
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
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

      {/* Add tenant — scoped to this property, so the form asks only for the person. */}
      <Dialog
        open={tenantDialog.isOpen}
        onOpenChange={(open) => !open && tenantDialog.closeDialog()}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("addTenant")}</DialogTitle>
            <DialogDescription>
              {t("month.subtitle", { property: property.name })}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={tenantDialog.handleSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="ten-name">{t("tenantName")}</Label>
              <Input
                id="ten-name"
                value={tenantDialog.formData.name}
                onChange={(e) => tenantDialog.updateFormData({ name: e.target.value })}
                className={tenantDialog.formErrors.name ? "border-[var(--color-destructive)]" : ""}
              />
              {tenantDialog.formErrors.name && (
                <p className="text-xs text-[var(--color-destructive)]">
                  {tenantDialog.formErrors.name}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ten-email">{t("email")}</Label>
              <Input
                id="ten-email"
                type="email"
                value={tenantDialog.formData.email}
                onChange={(e) => tenantDialog.updateFormData({ email: e.target.value })}
                className={tenantDialog.formErrors.email ? "border-[var(--color-destructive)]" : ""}
              />
              {tenantDialog.formErrors.email && (
                <p className="text-xs text-[var(--color-destructive)]">
                  {tenantDialog.formErrors.email}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ten-phone">{t("phone")}</Label>
                <Input
                  id="ten-phone"
                  value={tenantDialog.formData.phone}
                  onChange={(e) => tenantDialog.updateFormData({ phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ten-rent">{t("monthlyRent")}</Label>
                <Input
                  id="ten-rent"
                  type="number"
                  value={tenantDialog.formData.rent || ""}
                  onChange={(e) =>
                    tenantDialog.updateFormData({ rent: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={tenantDialog.closeDialog}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={tenantDialog.isSubmitting}>
                {t("addTenant")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
                    <p className="mt-1 text-sm font-medium capitalize text-[var(--color-foreground)]">
                      {selectedMonth.status ? selectedMonth.status.replace(/_/g, " ") : "—"}
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
                    receiptDialog.openDialog();
                  }}
                >
                  <Receipt className="mr-1.5 h-4 w-4" />
                  {t("actions.recordPayment")}
                </Button>

                {/* Named but disabled: both need backend work that does not exist yet
                    (bank-movement linking for a specific period, and issuing the AT rent
                    receipt from here). Shown so the intended shape of this modal is legible,
                    not to imply they work. */}
                <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
                  <p className="mono-label text-[var(--color-muted-foreground)]">
                    {t("month.comingSoon")}
                  </p>
                  <Button variant="outline" className="w-full justify-start" disabled>
                    {t("month.linkBankMovement")}
                  </Button>
                  <Button variant="outline" className="w-full justify-start" disabled>
                    {t("month.issueTaxReceipt")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* The four-card stat row that used to sit here has gone. Every number on it was already
          on screen: tenants and active leases are listed in People & Contracts below, open
          tickets were *already* badged on the Operations tab (so the count rendered three times
          on one screen), and revenue now badges the Money tab. Density rules 2 and 4 in
          CLAUDE.md — one stat row, and counts as text before counts as boxes. */}

      {/* Tabs. Five triggers overflowed their container by 207px at 390px, so Documents and
          Audit were reachable only by discovering a horizontal scroll — doctrine rule 4 swaps
          the bar for a select below `md`. Badge counts ride along as `Label (3)` so the mobile
          view states what the bar states. */}
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
            {
              value: "maintenance",
              label: t("tabs.operations"),
              badge: openTickets > 0 ? openTickets : undefined,
            },
            {
              value: "documents",
              label: t("actions.documents"),
              badge: propertyDocuments.length > 0 ? propertyDocuments.length : undefined,
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
              <span className="ml-1 bg-[var(--color-popover)] px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
                {formatCurrency(totalRevenue)}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            {t("tabs.operations")}
            {openTickets > 0 && (
              <span className="ml-1 bg-[var(--color-warning-muted)] text-[var(--color-warning)] px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] tabular-nums">
                {openTickets}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {t("actions.documents")}
            {propertyDocuments.length > 0 && (
              <span className="ml-1 bg-[var(--color-popover)] px-1.5 py-0.5 font-mono text-[12px] md:text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
                {propertyDocuments.length}
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
                  <dd className="text-sm font-medium capitalize">{property.type}</dd>
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
            {/* Edit sits with the fields it edits rather than in a global action bar. */}
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => editFormDialogRef.current?.openEditDialog(property)}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t("actions.edit")}
            </Button>
          </div>

          {/* Splits at @xl (36rem) rather than @2xl: the workspace container is ~644px at a
              1280px window, so a 42rem threshold left the pair stacked on the most common
              laptop width — the exact case this layout exists to fix. */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 @xl:grid-cols-2">
            {/* People & contracts — folds the former standalone Tenants and
                Leases tabs in here (Overview absorbs them per the tab merge). */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wider">
                  {t("related")}
                </h3>
                {/* Opens in place — the property is already known, so there is nothing to pick
                    and no reason to leave. Tenants below open the shared `?detail=tenant:<id>`
                    overlay on click (EntityLink), which is the edit path. */}
                <Button size="sm" variant="outline" onClick={tenantDialog.openDialog}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t("addTenant")}
                </Button>
              </div>
              {relatedTenants.map((tenant) => (
                <EntityLink
                  key={tenant.id}
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
                      title={`${formatCurrency(lease.monthlyRent)}/mo`}
                      subtitle={`${formatDay(lease.startDate)} — ${formatDay(lease.endDate)}`}
                      status={lease.status}
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
                      <div className="flex items-center justify-between rounded-md border border-[var(--color-warning)]/20 bg-[var(--color-warning-muted)] px-3 py-1.5">
                        <span className="text-xs text-[var(--color-warning)]">
                          {t("expiresIn", { days: daysUntilExpiry })}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-2 text-xs text-[var(--color-warning)] hover:bg-[var(--color-warning-muted)] hover:text-[var(--color-warning)]"
                          onClick={() => router.push("/leases")}
                        >
                          {t("renew")}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {relatedTenants.length === 0 && relatedLeases.length === 0 && (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-center space-y-2">
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {property.status === "vacant" ? t("vacantNotice") : t("noRelatedEntities")}
                  </p>
                  {property.status === "vacant" && (
                    <Button size="sm" variant="outline" onClick={() => router.push("/leases")}>
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      {t("createLease")}
                    </Button>
                  )}
                </div>
              )}
            </section>

            {/* Ownership & revenue share — the other half of the row, same section shape as its
                neighbour so the two read as a pair rather than a card stacked under a card. */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  <Users className="h-4 w-4" />
                  {t("ownership.title")}
                </h3>
                <span
                  className={cn(
                    "px-2 py-0.5 text-xs font-medium",
                    Math.abs(ownershipTotal - 100) < 0.01
                      ? "bg-[var(--color-success-muted)] text-[var(--color-success)]"
                      : ownershipTotal > 0
                        ? "bg-[var(--color-warning-muted)] text-[var(--color-warning)]"
                        : "bg-[var(--color-popover)] text-[var(--color-muted-foreground)]",
                  )}
                >
                  {t("ownership.assigned", { percent: ownershipTotal.toFixed(1) })}
                </span>
              </div>
              {propertyOwners.length === 0 ? (
                <p className="text-sm italic text-[var(--color-muted-foreground)]">
                  {t("ownership.none")}
                </p>
              ) : (
                <div className="space-y-2">
                  {propertyOwners.map(({ owner, assignment }) => {
                    const ownerIncome = relatedReceipts
                      .filter((r) => r.status === "paid")
                      .reduce((s, r) => s + r.amount * (assignment.ownershipPercentage / 100), 0);
                    return (
                      <div
                        key={owner.id}
                        className="flex items-center gap-3 p-2 rounded-lg bg-[var(--color-card-solid)] border border-[var(--color-border)]"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                            {owner.name}
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {owner.email}
                          </p>
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

        {/* Maintenance Tab */}
        <TabsContent value="maintenance">
          {relatedMaintenance.length === 0 ? (
            <EmptyStateIllustration entityType="maintenance" />
          ) : (
            <div className="space-y-3">
              {openTickets > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-warning)]">
                    {openTickets} open ticket{openTickets !== 1 ? "s" : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/operations?propertyId=${propertyId}`)}
                  >
                    <Wrench className="h-3.5 w-3.5 mr-1.5" />
                    View in Maintenance
                  </Button>
                </div>
              )}
              {relatedMaintenance.map((ticket) => (
                <Card key={ticket.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{ticket.title}</p>
                        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
                          {ticket.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            ticket.priority === "urgent" || ticket.priority === "high"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {ticket.priority}
                        </Badge>
                        <Badge
                          variant={
                            ticket.status === "resolved" || ticket.status === "closed"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {ticket.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Money Tab — Payments/P&L merged with the former standalone Expenses
            tab, per the tab merge (Overview/Money/Operations/Audit). */}
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
                      <div
                        key={tx.id}
                        className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0"
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
                          <p className="text-xs text-[var(--color-muted-foreground)]">{tx.date}</p>
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
                <p className="mono-label">Payment timeline</p>
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
                        {entry.reversedAt ? "Reversed" : "Allocated"} ·{" "}
                        {String(entry.period.month).padStart(2, "0")}/{entry.period.year}
                        <span className="ml-1 text-xs text-[var(--color-muted-foreground)]">
                          ({entry.type.replace(/_/g, " ")})
                        </span>
                      </span>
                    </div>
                    <span
                      className={cn(
                        "font-mono tabular-nums",
                        entry.reversedAt
                          ? "text-[var(--color-muted-foreground)] line-through"
                          : "text-[var(--color-foreground)]",
                      )}
                    >
                      €{entry.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Audit Tab — the shared AuditTrail component (GET /api/audit-trail), scoped to
            this property plus its tenants/leases/receipts/expenses (Migration A resourceId keys). */}
        {/* Documents — promoted from a header quick-action sheet to a tab of its own, grouped
            by document type so a property's paperwork reads as categories rather than one
            undifferentiated list. */}
        <TabsContent value="documents" className="space-y-6">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDocumentsOpen(true)}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {t("actions.manageDocuments")}
            </Button>
          </div>

          {propertyDocuments.length === 0 ? (
            <EmptyStateIllustration entityType="documents" />
          ) : (
            <div className="space-y-6">
              {Object.entries(
                propertyDocuments.reduce<Record<string, PropertyDocument[]>>((acc, doc) => {
                  (acc[doc.type] ??= []).push(doc);
                  return acc;
                }, {}),
              )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([type, docs]) => (
                  <div key={type} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--color-border)] pb-1.5">
                      <h3 className="mono-label">{documentTypeLabel(type)}</h3>
                      <span className="font-mono text-[12px] md:text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
                        {docs.length}
                      </span>
                    </div>
                    {docs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-3 py-1.5 text-sm"
                      >
                        <span className="truncate text-[var(--color-foreground)]" title={doc.name}>
                          {doc.name}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] md:text-[10px] tabular-nums text-[var(--color-muted-foreground)]">
                          {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </TabsContent>

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
