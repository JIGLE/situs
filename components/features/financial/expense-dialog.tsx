"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

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
import { parseAmountInput } from "@/lib/utils/money";
import {
  isDefaultDeductible,
  RECURRENCE_RULES,
  expenseSchema,
  type ExpenseFormData,
} from "@/lib/schemas/expense.schema";

export type ExpenseDialogState = UseFormDialogReturn<ExpenseFormData, Expense> & {
  /** Opens the form on a recorded expense, to change or delete it. */
  openExpense: (expense: Expense) => void;
};

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
  const onSubmit = useCallback(
    async (data: ExpenseFormData, isEdit: boolean) => {
      if (isEdit && editingId.current) {
        await updateExpense(editingId.current, data);
        return;
      }
      await addExpense({ ...data, propertyId: propertyId ?? data.propertyId });
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
  const { editingItem, openEditDialog } = dialog;
  useEffect(() => {
    editingId.current = editingItem?.id ?? null;
  }, [editingItem]);

  const openExpense = useCallback(
    (expense: Expense) => openEditDialog(expense, toFormData),
    [openEditDialog],
  );
  return { ...dialog, openExpense };
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
  const { formData, formErrors, updateFormData, editingItem } = dialog;
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
                    key={`${dialog.isOpen}-${editingItem?.id ?? "new"}`}
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
