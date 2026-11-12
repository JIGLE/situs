"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Repeat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { LoadingState } from "@/components/ui/loading-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import type { Expense } from "@/lib/types";
import { expenseCategoryKey } from "@/lib/utils/expense-labels";
import { nextOccurrence } from "@/lib/utils/expense-recurrence";
import { formatDate } from "@/lib/utils/format-date";
import { ExpenseDialog, useExpenseDialog } from "./expense-dialog";

const ALL = "all";

/**
 * Finance › Expenses: every cost recorded, newest first, with **Add expense**. A row opens the
 * expense in the same form, to change or delete it. Expenses used to sit
 * at the bottom of the Tax summary tab, under the income list, and only that tab could add one.
 */
export function ExpensesView() {
  const t = useTranslations("financial");
  const tCategories = useTranslations("financial.categories");
  const tForms = useTranslations("forms");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  const { state } = useApp();
  const { expenses, properties, loading } = state;
  const dialog = useExpenseDialog();
  const [propertyId, setPropertyId] = useState(ALL);

  const shown = useMemo(
    () =>
      expenses
        .filter((expense) => propertyId === ALL || expense.propertyId === propertyId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [expenses, propertyId],
  );
  const total = shown.reduce((sum, expense) => sum + expense.amount, 0);

  const categoryLabel = (category: string) => {
    const key = expenseCategoryKey(category);
    return key ? tCategories(key) : category;
  };

  // A recurring expense says when its next copy is due, so the owner can see it repeats.
  const repeatLine = (expense: Expense) => {
    const next = nextOccurrence(expense);
    return next
      ? t("expenseForm.repeats", {
          rule: expense.recurrenceRule ?? "monthly",
          date: formatDate(next, locale),
        })
      : t("expenseForm.repeatEnded");
  };

  if (loading) return <LoadingState variant="cards" count={4} />;

  return (
    // No heading: the tab label is this view's heading.
    <div className="space-y-4" data-testid="expenses-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t("expensesSummary", { count: shown.length, total: formatCurrency(total) })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {properties.length > 1 ? (
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger
                className="w-auto min-w-[10rem]"
                aria-label={t("expenseForm.property")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tForms("allProperties")}</SelectItem>
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button onClick={dialog.openDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("addExpense")}
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyStateIllustration
          type="expenses"
          title={t("noExpenseRecords")}
          description={t("addExpenseDesc")}
        />
      ) : (
        <ul className="panel divide-y divide-[var(--color-border)]">
          {shown.map((expense) => (
            <li key={expense.id}>
              {/* The whole row opens the expense, to change or delete it: there was no way to. */}
              <button
                type="button"
                onClick={() => dialog.openExpense(expense)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
              >
                <div className="min-w-0">
                  {/* Wraps rather than truncates: at phone width the property, date and note do
                      not fit on one line, and an ellipsis hides the part that tells two apart. */}
                  <p className="flex items-center gap-1.5 text-sm font-medium break-words">
                    {categoryLabel(expense.category)}
                    {expense.isRecurring || expense.parentExpenseId ? (
                      <Repeat
                        className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                        aria-hidden
                      />
                    ) : null}
                  </p>
                  <p className="text-xs break-words text-[var(--color-muted-foreground)]">
                    {expense.propertyName ?? t("unknownProperty")} ·{" "}
                    {formatDate(expense.date, locale)}
                    {expense.description ? ` · ${expense.description}` : ""}
                  </p>
                  {expense.isRecurring ? (
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {repeatLine(expense)}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatCurrency(expense.amount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ExpenseDialog dialog={dialog} />
    </div>
  );
}
