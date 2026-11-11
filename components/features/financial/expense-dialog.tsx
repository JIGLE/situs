"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useFormDialog, type UseFormDialogReturn } from "@/lib/hooks/use-form-dialog";
import {
  EXPENSE_CATEGORIES,
  RECURRENCE_RULES,
  expenseSchema,
  type ExpenseFormData,
} from "@/lib/schemas/expense.schema";

export type ExpenseDialogState = UseFormDialogReturn<ExpenseFormData>;

/**
 * The expense form's state. A property passed here is the expense's property, and the form does
 * not ask for one: that is the property page's case.
 */
export function useExpenseDialog(propertyId?: string): ExpenseDialogState {
  const { addExpense } = useApp();
  const t = useTranslations("financial");

  // Stable, so the hook does not reset the form on every render.
  const initialData = useMemo<ExpenseFormData>(
    () => ({
      propertyId: propertyId ?? "",
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      category: "other",
      description: "",
      isDeductible: true,
      isRecurring: false,
      recurrenceDay: 1,
      recurrenceEnd: null,
    }),
    [propertyId],
  );
  const onSubmit = useCallback(
    async (data: ExpenseFormData) => {
      await addExpense({ ...data, propertyId: propertyId ?? data.propertyId });
    },
    [addExpense, propertyId],
  );

  return useFormDialog<ExpenseFormData>({
    schema: expenseSchema,
    initialData,
    onSubmit,
    successMessage: {
      create: t("expenseForm.toastCreated"),
      update: t("expenseForm.toastUpdated"),
    },
  });
}

/**
 * **Registar despesa**, one form wherever an expense is recorded: Finance › Expenses, and a
 * property's Money tab, which passes its property. The property page used to carry a copy of its
 * own without the recurring options, so an expense could be repeated only from Finance.
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
  const { state } = useApp();
  const { currencySymbol } = useCurrency();
  const { formData, formErrors, updateFormData } = dialog;
  const fieldError = (field: keyof ExpenseFormData) =>
    formErrors[field] ? (
      <p className="text-sm text-[var(--semantic-danger-readable)]">{formErrors[field]}</p>
    ) : null;
  const invalid = (field: keyof ExpenseFormData) =>
    formErrors[field] ? "border-[var(--color-destructive)]" : "";

  return (
    <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--color-border)] bg-[var(--color-card-solid)] sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("recordExpense")}</DialogTitle>
          <DialogDescription>
            {propertyName ? t("addExpenseFor", { property: propertyName }) : t("addExpenseDesc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={dialog.handleSubmit} className="space-y-4">
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
                onValueChange={(value) =>
                  updateFormData({ category: value as ExpenseFormData["category"] })
                }
              >
                <SelectTrigger id="expense-category" className={invalid("category")}>
                  <SelectValue placeholder={t("expenseForm.selectCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {tCategories(category)}
                    </SelectItem>
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
                id="expense-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={formData.amount || ""}
                onChange={(e) => updateFormData({ amount: parseFloat(e.target.value) || 0 })}
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
                      updateFormData({ recurrenceDay: parseInt(e.target.value, 10) || undefined })
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
                    onChange={(e) => updateFormData({ recurrenceEnd: e.target.value || null })}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={dialog.closeDialog}>
              {tActions("cancel")}
            </Button>
            <Button type="submit" loading={dialog.isSubmitting}>
              {t("expenseForm.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
