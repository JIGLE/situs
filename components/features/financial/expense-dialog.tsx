"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Paperclip, ScanLine, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useToast } from "@/lib/contexts/toast-context";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { useFormDialog, type UseFormDialogReturn } from "@/lib/hooks/use-form-dialog";
import type { Expense } from "@/lib/types";
import {
  EXPENSE_CATEGORY_GROUPS,
  EXPENSE_CATEGORY_GROUP_KEYS,
  expenseCategoryKey,
  frequentCategories,
} from "@/lib/utils/expense-labels";
import { formatDate } from "@/lib/utils/format-date";
import { rememberedSupplier, type InvoiceFields } from "@/lib/utils/invoice-read";
import { parseAmountInput } from "@/lib/utils/money";
import { readInvoiceFile, uploadInvoice, type InvoiceRead } from "./invoice-reader";
import {
  isDefaultDeductible,
  RECURRENCE_RULES,
  expenseSchema,
  type ExpenseFormData,
} from "@/lib/schemas/expense.schema";

/** The invoice the open form came from, or that the owner attached to it. */
export interface PendingInvoice extends InvoiceRead {
  /** Its place in the files picked together: "2 of 3". */
  position: number;
  count: number;
}

export type ExpenseDialogState = UseFormDialogReturn<ExpenseFormData, Expense> & {
  /** Opens the form on a recorded expense, to change or delete it. */
  openExpense: (expense: Expense) => void;
  /**
   * Reads each invoice in turn and opens the form filled from it. Nothing is saved until the
   * owner checks it and presses Guardar, which keeps the file with the expense and opens the
   * next; Saltar leaves one out, closing the form stops.
   */
  readInvoices: (files: File[]) => void;
  /** Keeps a file with the expense on the form, without changing what was typed. */
  attachInvoice: (file: File) => void;
  skipInvoice: () => void;
  invoice: PendingInvoice | null;
  /** True while an invoice is being read. */
  readingInvoice: boolean;
};

/** The fields an invoice fills in. What it does not say is left as the form had it. */
function invoicePrefill(
  fields: InvoiceFields | null,
  expenses: readonly Expense[],
  fixedProperty: boolean,
): Partial<ExpenseFormData> {
  if (!fields) return {};
  const known = rememberedSupplier(expenses, fields.supplierNif);
  const category = known ? expenseCategoryKey(known.category) : undefined;
  return {
    ...(fields.total !== undefined ? { amount: fields.total } : {}),
    ...(fields.date ? { date: fields.date } : {}),
    ...(fields.supplierNif ? { vendorVat: fields.supplierNif } : {}),
    ...(fields.documentNumber ? { description: fields.documentNumber } : {}),
    ...(known?.vendorName ? { vendorName: known.vendorName } : {}),
    ...(category
      ? { category, isDeductible: known?.isDeductible ?? isDefaultDeductible(category) }
      : {}),
    ...(known && !fixedProperty ? { propertyId: known.propertyId } : {}),
  };
}

/** A recorded expense as the form's fields. A category from older data that is not one of
 * today's reads as "other", which the owner can then correct. */
function toFormData(expense: Expense): ExpenseFormData {
  return {
    propertyId: expense.propertyId,
    amount: expense.amount,
    date: expense.date.slice(0, 10),
    category: expenseCategoryKey(expense.category) ?? "other",
    description: expense.description ?? "",
    isDeductible: expense.isDeductible ?? true,
    vendorName: expense.vendorName ?? "",
    vendorVat: expense.vendorVat ?? "",
    isRecurring: !!expense.isRecurring,
    recurrenceRule: expense.recurrenceRule ?? undefined,
    recurrenceDay: expense.recurrenceDay ?? undefined,
    recurrenceEnd: expense.recurrenceEnd ? expense.recurrenceEnd.slice(0, 10) : null,
  };
}

/**
 * The expense form's state. A property passed here is the expense's property, and the form does
 * not ask for one: that is the property page's case. `openExpense` opens it on a recorded expense.
 */
export function useExpenseDialog(propertyId?: string): ExpenseDialogState {
  const { addExpense, updateExpense } = useApp();
  const t = useTranslations("financial");
  // The expense being changed, for the submit handler, which the form hook builds before it
  // can say which item is open.
  const editingId = useRef<string | null>(null);

  // Stable, so the hook does not reset the form on every render.
  const initialData = useMemo<ExpenseFormData>(
    () => ({
      propertyId: propertyId ?? "",
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      category: "other",
      description: "",
      isDeductible: isDefaultDeductible("other"),
      isRecurring: false,
      recurrenceDay: 1,
      recurrenceEnd: null,
    }),
    [propertyId],
  );
  // The invoice on the form, for the submit handler (state below is for the screen).
  const invoiceRef = useRef<PendingInvoice | null>(null);
  // Set by a save that came from a batch of invoices, so the next one opens after it.
  const advanceRef = useRef(false);

  const onSubmit = useCallback(
    async (data: ExpenseFormData, isEdit: boolean) => {
      const property = propertyId ?? data.propertyId;
      // The file is sent only now, once the owner has checked the expense it backs.
      const pending = invoiceRef.current;
      const documentId = pending ? await uploadInvoice(pending.upload, property) : undefined;
      const withDocument = documentId ? { ...data, documentId } : data;
      if (isEdit && editingId.current) {
        await updateExpense(editingId.current, withDocument);
      } else {
        await addExpense({ ...withDocument, propertyId: property });
      }
      advanceRef.current = pending !== null;
    },
    [addExpense, updateExpense, propertyId],
  );

  const dialog = useFormDialog<ExpenseFormData, Expense>({
    schema: expenseSchema,
    initialData,
    onSubmit,
    successMessage: {
      create: t("expenseForm.toastCreated"),
      update: t("expenseForm.toastUpdated"),
    },
  });
  const { editingItem, openEditDialog, openDialog, setFormData, isOpen, formData } = dialog;
  useEffect(() => {
    editingId.current = editingItem?.id ?? null;
  }, [editingItem]);

  const { state } = useApp();
  const [invoice, setInvoiceState] = useState<PendingInvoice | null>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [readingInvoice, setReadingInvoice] = useState(false);
  const setInvoice = useCallback((next: PendingInvoice | null) => {
    invoiceRef.current = next;
    setInvoiceState(next);
  }, []);

  const openNext = useCallback(
    async (files: File[], position: number, count: number) => {
      const [file, ...rest] = files;
      setQueue(rest);
      if (!file) {
        setInvoice(null);
        return;
      }
      setReadingInvoice(true);
      // Between two invoices the form closes; its reset runs 200ms after, so wait it out.
      const [read] = await Promise.all([
        readInvoiceFile(file),
        position > 1 ? new Promise((resolve) => setTimeout(resolve, 250)) : null,
      ]);
      setReadingInvoice(false);
      setInvoice({ ...read, position, count });
      openDialog();
      setFormData({
        ...initialData,
        ...invoicePrefill(read.fields, state.expenses, propertyId !== undefined),
      });
    },
    [initialData, openDialog, propertyId, setFormData, setInvoice, state.expenses],
  );

  const readInvoices = useCallback(
    (files: File[]) => {
      if (files.length > 0) void openNext(files, 1, files.length);
    },
    [openNext],
  );

  // A save from a batch opens the next invoice once the form has closed.
  useEffect(() => {
    if (isOpen || !advanceRef.current) return;
    advanceRef.current = false;
    const current = invoiceRef.current;
    if (current && queue.length > 0) void openNext(queue, current.position + 1, current.count);
    else setInvoice(null);
  }, [isOpen, openNext, queue, setInvoice]);

  const closeDialog = dialog.closeDialog;
  // Closing the form by hand stops the batch.
  const closeAll = useCallback(() => {
    setQueue([]);
    setInvoice(null);
    closeDialog();
  }, [closeDialog, setInvoice]);

  const skipInvoice = useCallback(() => {
    const current = invoiceRef.current;
    closeDialog();
    if (current && queue.length > 0) void openNext(queue, current.position + 1, current.count);
    else setInvoice(null);
  }, [closeDialog, openNext, queue, setInvoice]);

  const attachInvoice = useCallback(
    (file: File) => {
      setReadingInvoice(true);
      void readInvoiceFile(file).then((read) => {
        setReadingInvoice(false);
        setInvoice({ ...read, position: 1, count: 1 });
        // Fill only what the owner has not typed yet.
        const prefill = invoicePrefill(read.fields, state.expenses, true);
        setFormData({
          ...formData,
          ...(formData.amount ? {} : { amount: prefill.amount ?? 0 }),
          ...(formData.vendorVat ? {} : { vendorVat: prefill.vendorVat }),
          ...(formData.vendorName ? {} : { vendorName: prefill.vendorName }),
        });
      });
    },
    [formData, setFormData, setInvoice, state.expenses],
  );

  const openExpense = useCallback(
    (expense: Expense) => {
      setInvoice(null);
      openEditDialog(expense, toFormData);
    },
    [openEditDialog, setInvoice],
  );
  const openBlank = useCallback(() => {
    setInvoice(null);
    openDialog();
  }, [openDialog, setInvoice]);

  return {
    ...dialog,
    openDialog: openBlank,
    closeDialog: closeAll,
    openExpense,
    readInvoices,
    attachInvoice,
    skipInvoice,
    invoice,
    readingInvoice,
  };
}

/**
 * **Registar despesa**, one form wherever an expense is recorded or changed: Finance › Expenses,
 * and a property's Money tab, which passes its property. The property page used to carry a copy of
 * its own without the recurring options, so an expense could be repeated only from Finance.
 *
 * A sheet, full screen on a phone with Guardar always in view: as a dialog its buttons sat behind
 * the bottom navigation at 360px. A recorded expense opens here too, with Eliminar.
 */
export function ExpenseDialog({
  dialog,
  propertyName,
}: {
  dialog: ExpenseDialogState;
  /** Set when the property is fixed: the form then names it instead of asking for it. */
  propertyName?: string;
}) {
  const t = useTranslations("financial");
  const tCategories = useTranslations("financial.categories");
  const tActions = useTranslations("actions");
  const tGroups = useTranslations("financial.categoryGroups");
  const locale = useLocale();
  const { state, deleteExpense } = useApp();
  const { currencySymbol, formatCurrency } = useCurrency();
  const { success } = useToast();
  const confirmDialog = useConfirmDialog();
  const { formData, formErrors, updateFormData, editingItem, invoice } = dialog;
  const attachInput = useRef<HTMLInputElement>(null);
  // A copy a recurring expense made is one month's cost: it does not repeat itself.
  const isCopy = !!editingItem?.parentExpenseId;
  const frequent = useMemo(() => frequentCategories(state.expenses), [state.expenses]);
  // The amount as typed ("3200,00"), read on every keystroke; the field is keyed by the expense
  // so that opening another one starts it from that expense's amount.
  const amountDefault = formData.amount
    ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, useGrouping: false }).format(
        formData.amount,
      )
    : "";

  const askDelete = () => {
    if (!editingItem) return;
    confirmDialog.confirm(
      {
        title: t("expenseForm.deleteTitle"),
        description: t("expenseForm.deleteDescription", {
          amount: formatCurrency(editingItem.amount),
          date: formatDate(editingItem.date, locale),
        }),
        confirmLabel: tActions("delete"),
        cancelLabel: tActions("cancel"),
        variant: "destructive",
      },
      async () => {
        await deleteExpense(editingItem.id);
        success(t("expenseForm.toastDeleted"));
        dialog.closeDialog();
      },
    );
  };
  const fieldError = (field: keyof ExpenseFormData) =>
    formErrors[field] ? (
      <p className="text-sm text-[var(--semantic-danger-readable)]">{formErrors[field]}</p>
    ) : null;
  const invalid = (field: keyof ExpenseFormData) =>
    formErrors[field] ? "border-[var(--color-destructive)]" : "";

  return (
    <>
      <Sheet open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
        <SheetContent side="center" className="md:max-w-xl">
          <SheetHeader className="pr-14">
            <SheetTitle>{editingItem ? t("expenseForm.editTitle") : t("recordExpense")}</SheetTitle>
            <SheetDescription>
              {editingItem
                ? (editingItem.propertyName ?? propertyName ?? t("unknownProperty"))
                : propertyName
                  ? t("addExpenseFor", { property: propertyName })
                  : t("addExpenseDesc")}
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={dialog.handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {invoice ? (
                // What was read, and that it is a proposal: nothing is saved before Guardar.
                <div
                  className="space-y-1 border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-4 py-3 text-sm"
                  role="status"
                >
                  <p className="flex items-center gap-2 font-medium">
                    <ScanLine className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      {invoice.count > 1
                        ? `${t("invoice.position", { position: invoice.position, count: invoice.count })} · `
                        : ""}
                      {invoice.upload.name}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {invoice.fields?.source === "qr"
                      ? t("invoice.readQr")
                      : invoice.fields?.source === "text"
                        ? t("invoice.readText")
                        : t("invoice.unread")}
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {propertyName ? null : (
                  <div className="space-y-2">
                    <Label htmlFor="expense-property">{t("expenseForm.property")}</Label>
                    <Select
                      value={formData.propertyId}
                      onValueChange={(value) => updateFormData({ propertyId: value })}
                    >
                      <SelectTrigger id="expense-property" className={invalid("propertyId")}>
                        <SelectValue placeholder={t("expenseForm.selectProperty")} />
                      </SelectTrigger>
                      <SelectContent>
                        {state.properties.map((property) => (
                          <SelectItem key={property.id} value={property.id}>
                            {property.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldError("propertyId")}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="expense-category">{t("expenseForm.category")}</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => {
                      const category = value as ExpenseFormData["category"];
                      // Each category says whether it usually counts for IRS; the owner can
                      // still change it below.
                      updateFormData({ category, isDeductible: isDefaultDeductible(category) });
                    }}
                  >
                    <SelectTrigger id="expense-category" className={invalid("category")}>
                      <SelectValue placeholder={t("expenseForm.selectCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* The owner's usual costs first, then every category under its heading:
                          one column of 26 was a long scroll on a phone. A frequent category is
                          listed twice; Radix shows the one that is chosen as checked in both. */}
                      {frequent.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>{t("categoryGroupFrequent")}</SelectLabel>
                          {frequent.map((category) => (
                            <SelectItem key={`frequent-${category}`} value={category}>
                              {tCategories(category)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      {EXPENSE_CATEGORY_GROUP_KEYS.map((group) => (
                        <SelectGroup key={group}>
                          {/* "Outro" alone needs no heading over it. */}
                          {group === "other" ? null : <SelectLabel>{tGroups(group)}</SelectLabel>}
                          {EXPENSE_CATEGORY_GROUPS[group]
                            .filter((category) => !frequent.includes(category))
                            .map((category) => (
                              <SelectItem key={category} value={category}>
                                {tCategories(category)}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldError("category")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expense-amount">
                    {t("expenseForm.amount", { symbol: currencySymbol })}
                  </Label>
                  <Input
                    key={`${dialog.isOpen}-${editingItem?.id ?? "new"}-${invoice?.upload.name ?? ""}-${invoice?.position ?? 0}`}
                    id="expense-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    defaultValue={amountDefault}
                    onChange={(e) => {
                      const amount = parseAmountInput(e.target.value);
                      updateFormData({ amount: Number.isFinite(amount) ? amount : 0 });
                    }}
                    className={invalid("amount")}
                  />
                  {fieldError("amount")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expense-date">{t("expenseForm.date")}</Label>
                  <Input
                    id="expense-date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => updateFormData({ date: e.target.value })}
                    className={invalid("date")}
                  />
                  {fieldError("date")}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expense-description">{t("expenseForm.description")}</Label>
                <Textarea
                  id="expense-description"
                  value={formData.description || ""}
                  onChange={(e) => updateFormData({ description: e.target.value })}
                  placeholder={t("expenseForm.descriptionPlaceholder")}
                />
              </div>

              {/* The invoice kept with the expense: the proof the IRS asks a landlord to keep. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t("invoice.label")}</span>
                {editingItem?.documentId && !invoice ? (
                  <a
                    href={`/api/documents/${editingItem.documentId}/download`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-2 md:min-h-0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText className="h-4 w-4" aria-hidden />
                    {t("invoice.view")}
                  </a>
                ) : null}
                <input
                  ref={attachInput}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  aria-label={t("invoice.attach")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) dialog.attachInvoice(file);
                    e.target.value = "";
                  }}
                />
                {invoice ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    loading={dialog.readingInvoice}
                    onClick={() => attachInput.current?.click()}
                  >
                    <Paperclip className="h-4 w-4" aria-hidden />
                    {editingItem?.documentId ? t("invoice.replace") : t("invoice.attach")}
                  </Button>
                )}
              </div>

              {/* Who was paid, for the invoice record the IRS asks a landlord to keep. */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="expense-vendor">
                    {t("expenseForm.vendorName")}{" "}
                    <span className="font-normal text-[var(--color-muted-foreground)]">
                      ({t("expenseForm.optional")})
                    </span>
                  </Label>
                  <Input
                    id="expense-vendor"
                    autoComplete="off"
                    value={formData.vendorName ?? ""}
                    onChange={(e) => updateFormData({ vendorName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expense-vendor-vat">
                    {t("expenseForm.vendorVat")}{" "}
                    <span className="font-normal text-[var(--color-muted-foreground)]">
                      ({t("expenseForm.optional")})
                    </span>
                  </Label>
                  <Input
                    id="expense-vendor-vat"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={20}
                    value={formData.vendorVat ?? ""}
                    onChange={(e) => updateFormData({ vendorVat: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="expense-deductible" className="text-sm font-medium">
                    {t("deductibleLabel")}
                  </Label>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t("expenseDeductibilityNote")}
                  </p>
                </div>
                <Switch
                  id="expense-deductible"
                  checked={formData.isDeductible !== false}
                  onCheckedChange={(checked) => updateFormData({ isDeductible: checked })}
                />
              </div>

              {isCopy ? null : (
                <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="expense-recurring" className="text-sm font-medium">
                        {t("isRecurring")}
                      </Label>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t("recurringToggleDesc")}
                      </p>
                    </div>
                    <Switch
                      id="expense-recurring"
                      checked={!!formData.isRecurring}
                      onCheckedChange={(checked) =>
                        updateFormData({
                          isRecurring: checked,
                          recurrenceRule: checked ? "monthly" : undefined,
                          recurrenceDay: checked ? 1 : undefined,
                          recurrenceEnd: null,
                        })
                      }
                    />
                  </div>

                  {formData.isRecurring ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="expense-rule">{t("recurrenceRule")}</Label>
                        <Select
                          value={formData.recurrenceRule ?? "monthly"}
                          onValueChange={(value) =>
                            updateFormData({
                              recurrenceRule: value as (typeof RECURRENCE_RULES)[number],
                            })
                          }
                        >
                          <SelectTrigger id="expense-rule">
                            <SelectValue placeholder={t("expenseForm.selectFrequency")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">{t("recurrenceMonthly")}</SelectItem>
                            <SelectItem value="quarterly">{t("recurrenceQuarterly")}</SelectItem>
                            <SelectItem value="annual">{t("recurrenceAnnual")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="expense-day">{t("recurrenceDay")}</Label>
                        <Input
                          id="expense-day"
                          type="number"
                          min={1}
                          max={28}
                          value={formData.recurrenceDay ?? 1}
                          onChange={(e) =>
                            updateFormData({
                              recurrenceDay: parseInt(e.target.value, 10) || undefined,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="expense-end">
                          {t("recurrenceEnd")}{" "}
                          <span className="font-normal text-[var(--color-muted-foreground)]">
                            ({t("recurrenceEndPlaceholder")})
                          </span>
                        </Label>
                        <Input
                          id="expense-end"
                          type="date"
                          value={formData.recurrenceEnd ?? ""}
                          onChange={(e) =>
                            updateFormData({ recurrenceEnd: e.target.value || null })
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-6 py-4">
              {editingItem ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2 text-[var(--semantic-danger-readable)]"
                  onClick={askDelete}
                >
                  <Trash2 className="h-4 w-4" />
                  {tActions("delete")}
                </Button>
              ) : null}
              <div className="ml-auto flex gap-2">
                {invoice && invoice.position < invoice.count ? (
                  <Button type="button" variant="ghost" onClick={dialog.skipInvoice}>
                    {t("invoice.skip")}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={dialog.closeDialog}>
                  {tActions("cancel")}
                </Button>
                <Button type="submit" loading={dialog.isSubmitting}>
                  {editingItem ? tActions("save") : t("expenseForm.submit")}
                </Button>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}
