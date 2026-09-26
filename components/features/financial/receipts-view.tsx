"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatMonthYear } from "@/lib/utils/format-date";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  MoreHorizontal,
  Send,
  Trash2,
} from "lucide-react";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { RenderTable } from "@/components/ui/table";
import { LoadingState } from "@/components/ui/loading-state";
import { useApp } from "@/lib/contexts/app-context";
import { Receipt } from "@/lib/types";
import { receiptSchema, type ReceiptFormData } from "@/lib/schemas/receipt.schema";
import { RECEIPT_TYPE_KEY, receiptLifecycleKey } from "@/lib/utils/receipt-labels";
import { isFiled } from "@/lib/services/receipts/lifecycle";
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { sumMoney } from "@/lib/utils/money";
import {
  isIssuable,
  isVoidable,
  monthKeyString,
  receiptMonth,
  shiftMonth,
  type MonthKey,
} from "@/lib/utils/receipt-months";
import { cn } from "@/lib/utils/utils";
import { useToast } from "@/lib/contexts/toast-context";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import jsPDF from "jspdf";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";

export interface ReceiptsViewProps {
  tenantId?: string;
  propertyId?: string;
}

/** A receipt's document stage, by colour; the label beside it carries the meaning. */
const STAGE_STYLES: Record<string, string> = {
  draft: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  review: "bg-[var(--semantic-warning-soft)] text-[var(--semantic-warning-readable)]",
  rejected: "bg-[var(--semantic-danger-soft)] text-[var(--semantic-danger-readable)]",
  submitted: "bg-[var(--semantic-info-soft)] text-[var(--semantic-info-readable)]",
  accepted: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  emitted: "bg-[var(--semantic-success-soft)] text-[var(--semantic-success-readable)]",
  voided: "text-[var(--color-muted-foreground)] line-through",
};

const thisMonth = (): MonthKey => {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
};

interface IssueFailure {
  id: string;
  label: string;
  message: string;
}

/**
 * Finance › Recibos: one list per rent month.
 *
 * A receipt is listed under the rent month it paid, or the month it was paid when it paid none
 * (`lib/utils/receipt-months.ts`). Each row says whose receipt it is, for which month, what came
 * in and when, whether it is paid, its stage, and whether a bank movement or a person recorded it.
 * **Select all** takes the receipts that can be issued (draft or review), and **Emitir N** issues
 * them after a confirmation, saying which failed and why.
 *
 * This replaced two lists: a receipt queue above a list of cards titled "Receipt #" followed by
 * nothing, which showed every receipt ever recorded with no month and no stage. A payment is
 * recorded from the page's **Registar pagamento**, above every tab; this view's form edits one.
 */
export function ReceiptsView(props: ReceiptsViewProps) {
  const { state, updateReceipt, deleteReceipt, refreshData } = useApp();
  const { receipts, tenants, properties, loading } = state;
  const { success, error: showError } = useToast();
  const t = useTranslations("financial.receipts");
  const tActions = useTranslations("actions");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("status");
  const locale = useLocale();
  const apiError = useApiError();
  const { token: csrfToken } = useCsrf();
  /** The stored `type` is a database enum; its display name lives in the catalog. */
  const receiptTypeLabel = (type: Receipt["type"]) => t(RECEIPT_TYPE_KEY[type]);
  const { formatCurrency, currencySymbol } = useCurrency();
  const confirmDialog = useConfirmDialog();
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [month, setMonth] = useState<MonthKey>(thisMonth);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const [failures, setFailures] = useState<IssueFailure[]>([]);

  const initialFormData: ReceiptFormData = {
    tenantId: "",
    propertyId: "",
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    type: "rent",
    // A form that records a payment records money that arrived. Saved as pending, it was
    // chased as late five days on while the ledger already counted the month paid.
    status: "paid",
    description: "",
  };

  const dialog = useFormDialog<ReceiptFormData, Receipt>({
    schema: receiptSchema,
    initialData: initialFormData,
    // Edit only: a new payment goes through the page's Registar pagamento dialog.
    onSubmit: async (data) => {
      if (!dialog.editingItem) return;
      await updateReceipt(dialog.editingItem.id, data);
      success(t("toastUpdated"));
    },
    onError: (errorMessage) => {
      showError(errorMessage);
    },
    validation: { validateOnChange: true, debounceValidation: 300 },
  });

  const monthKey = monthKeyString(month);
  const monthReceipts = useMemo(
    () =>
      receipts
        .filter(
          (receipt) =>
            (!props.tenantId || receipt.tenantId === props.tenantId) &&
            (!props.propertyId || receipt.propertyId === props.propertyId) &&
            receiptMonth(receipt) === monthKey,
        )
        .sort(
          (a, b) =>
            a.tenantName.localeCompare(b.tenantName, "pt") ||
            a.propertyName.localeCompare(b.propertyName, "pt") ||
            b.date.localeCompare(a.date),
        ),
    [monthKey, props.propertyId, props.tenantId, receipts],
  );
  const issuable = monthReceipts.filter((receipt) => isIssuable(receipt.lifecycle));
  // Only what is still issuable counts: a receipt issued elsewhere since it was ticked drops out.
  const chosen = issuable.filter((receipt) => selected.has(receipt.id));
  const allChosen = issuable.length > 0 && chosen.length === issuable.length;

  const goToMonth = (delta: number) => {
    setMonth((current) => shiftMonth(current, delta));
    setSelected(new Set());
    setFailures([]);
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set(issuable.map((receipt) => receipt.id)) : new Set());

  const rowLabel = (receipt: Receipt) => `${receipt.tenantName} · ${receipt.propertyName}`;

  const moveTo = (receipt: Receipt, to: "emitted" | "voided") =>
    apiFetch(`/api/receipts/${receipt.id}/lifecycle`, csrfToken, "PUT", { to });

  const issueChosen = () => {
    const batch = chosen;
    confirmDialog.confirm(
      {
        title: t("issueDialog.title", { count: batch.length }),
        description: t("issueDialog.description"),
        confirmLabel: t("issueDialog.confirmLabel"),
      },
      async () => {
        setIssuing(true);
        setFailures([]);
        const failed: IssueFailure[] = [];
        // One at a time: each issue archives a PDF, and a refusal names only its own receipt.
        for (const receipt of batch) {
          try {
            await moveTo(receipt, "emitted");
          } catch (err) {
            failed.push({ id: receipt.id, label: rowLabel(receipt), message: apiError(err) });
          }
        }
        const issued = batch.length - failed.length;
        if (issued > 0) success(t("issued", { count: issued }));
        setFailures(failed);
        // The ones that failed stay ticked, so a retry is one click.
        setSelected(new Set(failed.map((failure) => failure.id)));
        await refreshData();
        setIssuing(false);
      },
    );
  };

  const handleVoid = (receipt: Receipt) => {
    confirmDialog.confirm(
      {
        title: t("voidDialog.title"),
        description: t("voidDialog.description"),
        confirmLabel: t("voidDialog.confirmLabel"),
        variant: "destructive",
      },
      async () => {
        try {
          await moveTo(receipt, "voided");
          success(t("toastVoided"));
          // Voiding reversed the payment: the month it paid and the tenant's status moved.
          await refreshData();
        } catch (err) {
          showError(apiError(err));
        }
      },
    );
  };

  const handleEdit = (receipt: Receipt) => {
    dialog.openEditDialog(receipt, (r) => ({
      tenantId: r.tenantId,
      propertyId: r.propertyId,
      amount: r.amount,
      date: r.date,
      type: r.type,
      status: r.status,
      description: r.description || "",
    }));
  };

  const handleDelete = (receipt: Receipt) => {
    // The route refuses these too; saying why here spares a round trip that could only answer
    // with a generic conflict.
    if (isFiled(receipt.lifecycle)) {
      showError(t("deleteFiled"));
      return;
    }
    confirmDialog.confirm(
      {
        title: t("deleteDialog.title"),
        description: t("deleteDialog.description"),
        confirmLabel: t("deleteDialog.confirmLabel"),
        variant: "destructive",
      },
      async () => {
        await deleteReceipt(receipt.id);
        success(t("toastDeleted"));
        // The delete moved the rent ledger: the month it paid and the tenant's payment status.
        await refreshData();
      },
    );
  };

  /**
   * Serve the archived PDF when the receipt has one, and render a fresh copy when it does not.
   *
   * The two are not interchangeable. The archive is written when a receipt reaches
   * emitted/accepted and is the proof of a filing made at Finanças; the jsPDF render below is
   * a convenience copy built from whatever this row currently holds. A receipt that has been
   * emitted must hand over the former, so the archive is tried first and the render is the
   * fallback for drafts and pre-lifecycle rows, which legitimately have no archive.
   */
  const downloadArchivedPdf = async (receipt: Receipt): Promise<boolean> => {
    const res = await fetch(`/api/receipts/${receipt.id}/archive`, { credentials: "include" });
    if (!res.ok) return false; // 404 is the ordinary "never emitted" answer.

    const body = await res.json();
    const documentId = (body?.data ?? body)?.documentId;
    if (!documentId) return false;

    const file = await fetch(`/api/documents/${documentId}/download`, {
      credentials: "include",
    });
    if (!file.ok) return false;

    const blob = await file.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt-${receipt.id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  };

  const generatePDF = async (receipt: Receipt) => {
    setGeneratingPdf(receipt.id);

    try {
      if (await downloadArchivedPdf(receipt)) return;

      const doc = new jsPDF();

      // Set up the PDF
      doc.setFontSize(20);
      doc.text(t("pdf.heading"), 105, 20, { align: "center" });

      // Receipt details
      doc.setFontSize(12);
      doc.text(`${t("pdf.number")}: ${receipt.id}`, 20, 40);
      doc.text(`${t("pdf.date")}: ${new Date(receipt.date).toLocaleDateString(locale)}`, 20, 50);

      // Separator
      doc.setLineWidth(0.5);
      doc.line(20, 60, 190, 60);

      // Tenant and Property Info
      doc.setFontSize(14);
      doc.text(t("pdf.tenantSection"), 20, 75);
      doc.setFontSize(11);
      doc.text(`${t("pdf.name")}: ${receipt.tenantName}`, 20, 85);
      doc.text(`${t("pdf.property")}: ${receipt.propertyName}`, 20, 95);

      // Payment details
      doc.setFontSize(14);
      doc.text(t("pdf.paymentSection"), 20, 115);
      doc.setFontSize(11);
      doc.text(`${t("pdf.amount")}: ${formatCurrency(receipt.amount)}`, 20, 125);
      doc.text(`${t("pdf.type")}: ${receiptTypeLabel(receipt.type)}`, 20, 135);
      if (receipt.description) {
        doc.text(`${t("pdf.description")}: ${receipt.description}`, 20, 145);
      }

      // Footer
      doc.setFontSize(10);
      doc.text(t("pdf.thanks"), 105, 170, { align: "center" });

      // Save the PDF
      doc.save(`receipt-${receipt.id}.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
      showError(t("pdfFailed"));
    } finally {
      setGeneratingPdf(null);
    }
  };

  const stageBadge = (receipt: Receipt) => {
    const key = receiptLifecycleKey(receipt.lifecycle);
    return key ? (
      <Badge className={STAGE_STYLES[receipt.lifecycle ?? ""] ?? ""}>{t(key)}</Badge>
    ) : null;
  };

  const paymentBadge = (receipt: Receipt) => (
    <Badge variant={receipt.status === "paid" ? "status-success" : "status-warning"}>
      {tStatus(receipt.status === "paid" ? "paid" : "pending")}
    </Badge>
  );

  const sourceLabel = (receipt: Receipt) =>
    t(receipt.source === "automation" ? "source.bank" : "source.manual");

  /** The rent month it paid; otherwise its type, or for rent that paid no month, that it did not. */
  const rentMonthLabel = (receipt: Receipt) => {
    if (!receipt.referenceMonth) {
      return receipt.type === "rent" ? t("noRentMonth") : receiptTypeLabel(receipt.type);
    }
    const [year, m] = receipt.referenceMonth.split("-").map(Number);
    return formatMonthYear(year, m, locale);
  };

  const rowCheckbox = (receipt: Receipt) =>
    isIssuable(receipt.lifecycle) ? (
      <Checkbox
        checked={selected.has(receipt.id)}
        onCheckedChange={(on) => toggle(receipt.id, on)}
        aria-label={t("selectOne", { receipt: rowLabel(receipt) })}
        wrapperClassName="min-h-11 min-w-11 justify-center md:min-h-0 md:min-w-0"
      />
    ) : null;

  const rowActions = (receipt: Receipt) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("options")}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => generatePDF(receipt)}
          disabled={generatingPdf === receipt.id}
        >
          <Download className="h-4 w-4 mr-2" />
          {generatingPdf === receipt.id ? t("pdfGenerating") : t("pdfDownload")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleEdit(receipt)}>
          <Edit className="h-4 w-4 mr-2" />
          {t("edit")}
        </DropdownMenuItem>
        {isVoidable(receipt.lifecycle) ? (
          <DropdownMenuItem onClick={() => handleVoid(receipt)}>
            <Ban className="h-4 w-4 mr-2" />
            {t("void")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(receipt)}>
          <Trash2 className="h-4 w-4 mr-2" />
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const editDialog = (
    <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
      <DialogContent className="bg-[var(--color-card)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[var(--color-foreground)]">{t("editTitle")}</DialogTitle>
          <DialogDescription>{t("editDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={dialog.handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tenant">{t("tenant")}</Label>
              <Select
                value={dialog.formData.tenantId}
                onValueChange={(value) => dialog.updateFormData({ tenantId: value })}
              >
                <SelectTrigger className={dialog.formErrors.tenantId ? "border-red-500" : ""}>
                  <SelectValue placeholder={t("selectTenant")} />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dialog.formErrors.tenantId && (
                <p className="text-sm text-destructive">{dialog.formErrors.tenantId}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="property">{t("property")}</Label>
              <Select
                value={dialog.formData.propertyId}
                onValueChange={(value) => dialog.updateFormData({ propertyId: value })}
              >
                <SelectTrigger className={dialog.formErrors.propertyId ? "border-red-500" : ""}>
                  <SelectValue placeholder={t("selectProperty")} />
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
              <Label htmlFor="amount">{t("amount", { symbol: currencySymbol })}</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={dialog.formData.amount}
                onChange={(e) =>
                  dialog.updateFormData({
                    amount: parseFloat(e.target.value) || 0,
                  })
                }
                className={dialog.formErrors.amount ? "border-red-500" : ""}
                required
              />
              {dialog.formErrors.amount && (
                <p className="text-sm text-destructive">{dialog.formErrors.amount}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">{t("paymentDate")}</Label>
              <Input
                id="date"
                type="date"
                value={dialog.formData.date}
                onChange={(e) => dialog.updateFormData({ date: e.target.value })}
                className={dialog.formErrors.date ? "border-red-500" : ""}
                required
              />
              {dialog.formErrors.date && (
                <p className="text-sm text-destructive">{dialog.formErrors.date}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">{t("paymentType")}</Label>
              <Select
                value={dialog.formData.type}
                onValueChange={(value: Receipt["type"]) => dialog.updateFormData({ type: value })}
              >
                <SelectTrigger className={dialog.formErrors.type ? "border-red-500" : ""}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rent">{t("typeRent")}</SelectItem>
                  <SelectItem value="deposit">{t("typeDeposit")}</SelectItem>
                  <SelectItem value="maintenance">{t("typeMaintenance")}</SelectItem>
                  <SelectItem value="other">{t("typeOther")}</SelectItem>
                </SelectContent>
              </Select>
              {dialog.formErrors.type && (
                <p className="text-sm text-destructive">{dialog.formErrors.type}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("descriptionOptional")}</Label>
            <Textarea
              id="description"
              value={dialog.formData.description}
              onChange={(e) => dialog.updateFormData({ description: e.target.value })}
              className={dialog.formErrors.description ? "border-red-500" : ""}
              rows={3}
            />
            {dialog.formErrors.description && (
              <p className="text-sm text-destructive">{dialog.formErrors.description}</p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={dialog.closeDialog}>
              {tActions("cancel")}
            </Button>
            <Button type="submit" loading={dialog.isSubmitting}>
              {t("submitUpdate")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  const monthName = formatMonthYear(month.year, month.month, locale);

  return (
    <>
      {loading ? (
        <LoadingState variant="cards" count={6} />
      ) : (
        // No heading: the tab label is this view's heading.
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => goToMonth(-1)}
                aria-label={tCommon("previousMonth")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span
                className="inline-block min-w-36 text-center text-sm font-medium first-letter:uppercase"
                aria-live="polite"
              >
                {monthName}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => goToMonth(1)}
                aria-label={tCommon("nextMonth")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {chosen.length > 0 ? (
              <Button onClick={issueChosen} loading={issuing} className="gap-2">
                <Send className="h-4 w-4" />
                {t("issueSelected", { count: chosen.length })}
              </Button>
            ) : null}
          </div>

          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("monthSummary", {
              count: monthReceipts.length,
              toIssue: issuable.length,
              total: formatCurrency(sumMoney(monthReceipts.map((receipt) => receipt.amount))),
            })}
          </p>

          {failures.length > 0 ? (
            <div
              role="alert"
              className="space-y-1 border-l-[3px] border-l-[var(--semantic-danger)] bg-[var(--semantic-danger-soft)] px-3 py-2 text-sm text-[var(--semantic-danger-readable)]"
            >
              <p className="font-medium">{t("issueFailed")}</p>
              <ul className="space-y-0.5">
                {failures.map((failure) => (
                  <li key={failure.id}>
                    {failure.label}: {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The table's header box selects all on a computer; the cards have no header, so a
              phone gets this row instead. One of the two is ever shown. */}
          {issuable.length > 0 ? (
            <div className="flex items-center gap-1 md:hidden">
              <Checkbox
                checked={allChosen}
                indeterminate={chosen.length > 0 && !allChosen}
                onCheckedChange={toggleAll}
                aria-label={t("selectAll")}
                wrapperClassName="min-h-11 min-w-11 justify-center"
              />
              <span className="text-sm text-[var(--color-muted-foreground)]" aria-hidden>
                {t("selectAll")}
              </span>
            </div>
          ) : null}

          <div className="border border-[var(--color-border)] bg-[var(--color-surface)]">
            <RenderTable
              data={monthReceipts}
              rowKey={(receipt) => receipt.id}
              cardMode
              emptyState={
                <p className="p-6 text-sm text-[var(--color-muted-foreground)]">
                  {t("emptyMonth", { month: monthName })}
                </p>
              }
              rowClassName={(receipt) =>
                selected.has(receipt.id) ? "bg-[var(--color-sidebar-active)]" : undefined
              }
              columns={[
                {
                  key: "select",
                  header: issuable.length ? (
                    <Checkbox
                      checked={allChosen}
                      indeterminate={chosen.length > 0 && !allChosen}
                      onCheckedChange={toggleAll}
                      aria-label={t("selectAll")}
                    />
                  ) : (
                    <span className="sr-only">{t("selectAll")}</span>
                  ),
                  cell: rowCheckbox,
                  headerClassName: "w-10",
                },
                {
                  key: "receipt",
                  header: t("tenant"),
                  cell: (receipt) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--color-foreground)]">
                        {receipt.tenantName}
                      </p>
                      <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                        {receipt.propertyName}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "month",
                  header: t("rentMonth"),
                  cell: rentMonthLabel,
                },
                {
                  key: "received",
                  header: t("received"),
                  cell: (receipt) => (
                    <div>
                      <p className="tabular-nums text-[var(--color-foreground)]">
                        {formatCurrency(receipt.amount)}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {formatDate(receipt.date, locale)}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "state",
                  header: t("state"),
                  cell: (receipt) => (
                    <div className="flex flex-wrap gap-1">
                      {paymentBadge(receipt)}
                      {stageBadge(receipt)}
                    </div>
                  ),
                },
                {
                  key: "source",
                  header: t("sourceHeader"),
                  cell: (receipt) => (
                    <span className="text-[var(--color-muted-foreground)]">
                      {sourceLabel(receipt)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: <span className="sr-only">{t("options")}</span>,
                  cell: rowActions,
                  cellClassName: "text-right",
                },
              ]}
              renderCard={(receipt) => (
                <div
                  className={cn(
                    "flex items-start gap-2 border-b border-[var(--color-border)] p-3 last:border-b-0",
                    selected.has(receipt.id) && "bg-[var(--color-sidebar-active)]",
                  )}
                >
                  <div className="w-11 shrink-0">{rowCheckbox(receipt)}</div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-medium text-[var(--color-foreground)]">
                        {receipt.tenantName}
                      </p>
                      <p className="shrink-0 tabular-nums text-[var(--color-foreground)]">
                        {formatCurrency(receipt.amount)}
                      </p>
                    </div>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      {receipt.propertyName} · {rentMonthLabel(receipt)} ·{" "}
                      {formatDate(receipt.date, locale)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {paymentBadge(receipt)}
                      {stageBadge(receipt)}
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {sourceLabel(receipt)}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">{rowActions(receipt)}</div>
                </div>
              )}
            />
          </div>
        </div>
      )}
      {editDialog}
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}
