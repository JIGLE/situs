"use client";

import { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils/format-date";
import {
  FileText,
  Download,
  Calendar,
  Plus,
  Edit,
  Trash2,
  DollarSign,
  MoreHorizontal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useApp } from "@/lib/contexts/app-context";
import { Receipt } from "@/lib/types";
import { receiptSchema, type ReceiptFormData } from "@/lib/schemas/receipt.schema";
import { RECEIPT_TYPE_KEY } from "@/lib/utils/receipt-labels";
import { isFiled } from "@/lib/services/receipts/lifecycle";
import { useToast } from "@/lib/contexts/toast-context";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import jsPDF from "jspdf";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { PageHeader } from "@/components/shared/page-header";

export interface ReceiptsViewProps {
  tenantId?: string;
  propertyId?: string;
  /**
   * Opens **Registar pagamento** (`RecordPaymentDialog`), which the page holds so it can open
   * from any tab. Without it, the add button opens this view's own form.
   */
  onRecordPayment?: () => void;
  /**
   * Drops the internal `PageHeader` (title/description) when this view is mounted
   * inside another surface that already renders its own heading — e.g. the property
   * detail "Review Payments" overlay. The Add Receipt action stays available.
   */
  embedded?: boolean;
}

export interface ReceiptsViewRef {
  openDialog: () => void;
}

export const ReceiptsView = forwardRef<ReceiptsViewRef, ReceiptsViewProps>(
  function ReceiptsView(props, ref) {
    const { state, addReceipt, updateReceipt, deleteReceipt, refreshData } = useApp();
    const { receipts, tenants, properties, loading } = state;
    const { success, error: showError } = useToast();
    const t = useTranslations("financial.receipts");
    const tActions = useTranslations("actions");
    const locale = useLocale();
    /** The stored `type` is a database enum; its display name lives in the catalog. */
    const receiptTypeLabel = (type: Receipt["type"]) => t(RECEIPT_TYPE_KEY[type]);
    const { formatCurrency, currencySymbol } = useCurrency();
    const confirmDialog = useConfirmDialog();
    const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);

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
      onSubmit: async (data, isEdit) => {
        if (isEdit && dialog.editingItem) {
          await updateReceipt(dialog.editingItem.id, data);
          success(t("toastUpdated"));
        } else {
          await addReceipt(data);
          success(t("toastCreated"));
        }
      },
      onError: (errorMessage) => {
        showError(errorMessage);
      },
      validation: { validateOnChange: true, debounceValidation: 300 },
    });
    const { editingItem, isOpen, openDialog, updateFormData } = dialog;

    useImperativeHandle(ref, () => ({
      openDialog,
    }));

    useEffect(() => {
      if (!isOpen || editingItem) {
        return;
      }

      const updates: Partial<ReceiptFormData> = {};
      if (props.tenantId) {
        updates.tenantId = props.tenantId;
      }
      if (props.propertyId) {
        updates.propertyId = props.propertyId;
      }

      if (Object.keys(updates).length > 0) {
        updateFormData(updates);
      }
    }, [editingItem, isOpen, props.propertyId, props.tenantId, updateFormData]);

    const filteredReceipts = useMemo(
      () =>
        receipts.filter((receipt) => {
          if (props.tenantId && receipt.tenantId !== props.tenantId) {
            return false;
          }
          if (props.propertyId && receipt.propertyId !== props.propertyId) {
            return false;
          }
          return true;
        }),
      [props.propertyId, props.tenantId, receipts],
    );

    const description = props.tenantId
      ? t("descriptionTenant")
      : props.propertyId
        ? t("descriptionProperty")
        : t("descriptionOwner");

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

    const getTypeBadge = (type: Receipt["type"]) => {
      const colors = {
        rent: "bg-[var(--color-info-muted)] text-[var(--color-info)]",
        deposit: "bg-[var(--color-success-muted)] text-[var(--color-success)]",
        maintenance: "bg-orange-600/20 text-orange-400",
        other: "bg-[var(--color-popover)] text-[var(--color-muted-foreground)]",
      };
      return <Badge className={colors[type]}>{type.charAt(0).toUpperCase() + type.slice(1)}</Badge>;
    };

    const addReceiptButton = (
      <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
        <DialogTrigger asChild>
          <Button
            onClick={props.onRecordPayment ?? dialog.openDialog}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t("addReceipt")}
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-[var(--color-card)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[var(--color-foreground)]">
              {dialog.editingItem ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {dialog.editingItem ? t("editDescription") : t("createDescription")}
            </DialogDescription>
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
                {dialog.editingItem ? t("submitUpdate") : t("submitCreate")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );

    return (
      <>
        {loading ? (
          <LoadingState variant="cards" count={6} />
        ) : (
          <div className="space-y-6">
            {props.embedded ? (
              addReceiptButton && <div className="flex justify-end">{addReceiptButton}</div>
            ) : (
              <PageHeader title={t("title")} description={description}>
                {addReceiptButton}
              </PageHeader>
            )}

            <div className="grid gap-4">
              {filteredReceipts.length === 0 ? (
                <EmptyStateIllustration type="receipts" onAction={dialog.openDialog} />
              ) : (
                filteredReceipts.map((receipt) => (
                  <Card
                    key={receipt.id}
                    className="bg-[var(--color-card)] border-[var(--color-border)]"
                  >
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface)]">
                            <FileText className="h-6 w-6 text-[var(--color-muted-foreground)]" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-lg font-semibold text-[var(--color-foreground)]">
                                Receipt #{receipt.id.split("-")[1]}
                              </h3>
                              {getTypeBadge(receipt.type)}
                            </div>
                            <p className="text-sm text-[var(--color-muted-foreground)]">
                              {receipt.tenantName} - {receipt.propertyName}
                            </p>
                            <div className="flex items-center gap-4 text-sm text-[var(--color-muted-foreground)] mt-1">
                              <div className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                <span>{formatDate(receipt.date, locale)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <DollarSign className="w-4 h-4" />
                                <span>{formatCurrency(receipt.amount)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={t("options")}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => generatePDF(receipt)}
                                disabled={generatingPdf === receipt.id}
                              >
                                <Download className="h-4 w-4 mr-2" />
                                {generatingPdf === receipt.id
                                  ? t("pdfGenerating")
                                  : t("pdfDownload")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEdit(receipt)}>
                                <Edit className="h-4 w-4 mr-2" />
                                {t("edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(receipt)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {t("delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      {receipt.description && (
                        <p className="text-sm text-[var(--color-muted-foreground)] mt-4">
                          {receipt.description}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
        <ConfirmationDialog dialog={confirmDialog} />
      </>
    );
  },
);

ReceiptsView.displayName = "ReceiptsView";
