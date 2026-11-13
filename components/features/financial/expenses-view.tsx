"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useRoutePathname } from "@/lib/hooks/use-route-pathname";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import { Plus, Repeat, ScanLine } from "lucide-react";

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
import {
  EXPENSE_CATEGORY_GROUP_KEYS,
  type ExpenseCategoryGroup,
  expenseCategoryGroup,
  expenseCategoryKey,
} from "@/lib/utils/expense-labels";
import { expenseYears, isDeductible, summariseYear } from "@/lib/utils/expense-year";
import { nextOccurrence } from "@/lib/utils/expense-recurrence";
import { formatDate } from "@/lib/utils/format-date";
import { ExpenseDialog, useExpenseDialog } from "./expense-dialog";

const ALL = "all";

/**
 * Finance › Expenses, one year at a time: the year's total and its deductible part, the months
 * newest first with each month's total, and each property's totals for the IRS Anexo F. A row opens
 * the expense in the same form, to change or delete it. Expenses used to be one undated list with
 * a single total across every year, and only a property could narrow it.
 */
export function ExpensesView() {
  const t = useTranslations("financial");
  const tCategories = useTranslations("financial.categories");
  const tGroups = useTranslations("financial.categoryGroups");
  const tForms = useTranslations("forms");
  const locale = useLocale();
  const { formatCurrency } = useCurrency();
  const { state } = useApp();
  const { expenses, properties, loading } = state;
  const dialog = useExpenseDialog();
  const router = useRouter();
  const pathname = useRoutePathname();
  const searchParams = useSearchParams();
  // A unit's part of a building expense opens the building, where the whole cost is changed.
  const openExpense = (expense: Expense) =>
    expense.building
      ? router.push(
          withEntityDetail(pathname, searchParams.toString(), "building", expense.building.id),
        )
      : dialog.openExpense(expense);
  const invoiceInput = useRef<HTMLInputElement>(null);
  const [propertyId, setPropertyId] = useState(ALL);
  const [group, setGroup] = useState<ExpenseCategoryGroup | typeof ALL>(ALL);
  const years = useMemo(() => expenseYears(expenses), [expenses]);
  const [year, setYear] = useState(() => new Date().getFullYear());

  const filtered = useMemo(
    () =>
      expenses.filter(
        (expense) =>
          (propertyId === ALL || expense.propertyId === propertyId) &&
          (group === ALL || expenseCategoryGroup(expense.category) === group),
      ),
    [expenses, propertyId, group],
  );
  const summary = useMemo(() => summariseYear(filtered, year), [filtered, year]);

  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 1)),
    );

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
          {t("expensesYearSummary", {
            count: summary.count,
            total: formatCurrency(summary.total),
            deductible: formatCurrency(summary.deductible),
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* One or many invoices, PDFs or photos: each opens the form filled from it, to check
              and save in turn. */}
          <input
            ref={invoiceInput}
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="hidden"
            aria-label={t("invoice.readButton")}
            onChange={(e) => {
              dialog.readInvoices(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            className="gap-2"
            loading={dialog.readingInvoice}
            onClick={() => invoiceInput.current?.click()}
          >
            <ScanLine className="h-4 w-4" />
            {t("invoice.readButton")}
          </Button>
          <Button onClick={dialog.openDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("addExpense")}
          </Button>
        </div>
      </div>

      {/* Three dropdowns fit inline (density rule 3); below that they wrap. */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger className="w-auto min-w-[6.5rem]" aria-label={t("expenseYear")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {properties.length > 1 ? (
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="w-auto min-w-[10rem]" aria-label={t("expenseForm.property")}>
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
        <Select
          value={group}
          onValueChange={(value) => setGroup(value as ExpenseCategoryGroup | typeof ALL)}
        >
          <SelectTrigger className="w-auto min-w-[10rem]" aria-label={t("expenseForm.category")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allCategories")}</SelectItem>
            {EXPENSE_CATEGORY_GROUP_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {tGroups(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {summary.count === 0 ? (
        <EmptyStateIllustration
          type="expenses"
          title={t("noExpenseRecords")}
          description={t("addExpenseDesc")}
        />
      ) : (
        <>
          {summary.months.map((month) => (
            <section key={month.month} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="text-sm font-medium first-letter:uppercase">
                  {monthName(month.month)}
                </h3>
                <span className="text-sm tabular-nums text-[var(--color-muted-foreground)]">
                  {formatCurrency(month.total)}
                </span>
              </div>
              <ul className="panel divide-y divide-[var(--color-border)]">
                {month.items.map((expense) => (
                  <li key={expense.id}>
                    {/* The whole row opens the expense, to change or delete it. */}
                    <button
                      type="button"
                      onClick={() => openExpense(expense)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:outline-none"
                    >
                      <div className="min-w-0">
                        {/* Wraps rather than truncates: at phone width the property, date and
                            note do not fit on one line, and an ellipsis hides what tells two
                            apart. */}
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
                          {[
                            expense.propertyName ?? t("unknownProperty"),
                            formatDate(expense.date, locale),
                            expense.vendorName,
                            expense.description,
                            isDeductible(expense) ? null : t("notDeductible"),
                            expense.bankTransactionId ? t("paidFromBank") : null,
                            expense.paidByOwnerId
                              ? t("paidByOwner", {
                                  name:
                                    state.owners.find((o) => o.id === expense.paidByOwnerId)
                                      ?.name ?? "—",
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {expense.building ? (
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {t("buildingPart", {
                              building: expense.building.name,
                              total: formatCurrency(expense.building.totalAmount),
                            })}
                          </p>
                        ) : null}
                        {expense.isRecurring ? (
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {repeatLine(expense)}
                          </p>
                        ) : null}
                        {/* A recurring month the bank has not shown being paid: perhaps it was
                            not charged, or was paid another way. */}
                        {expense.notSeenInBank ? (
                          <p className="text-xs text-[var(--semantic-warning-readable)]">
                            {t("notSeenInBank")}
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
            </section>
          ))}

          {/* What the IRS Anexo F asks for, property by property. */}
          <section className="space-y-2 pt-2">
            <div className="px-1">
              <h3 className="text-sm font-medium">{t("expensesByProperty")}</h3>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {t("expensesByPropertyHint")}
              </p>
            </div>
            <ul className="panel divide-y divide-[var(--color-border)]">
              {summary.byProperty.map((property) => (
                <li
                  key={property.propertyId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 text-sm break-words">
                    {property.propertyName ?? t("unknownProperty")}
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {formatCurrency(property.total)}
                    <span className="block text-xs text-[var(--color-muted-foreground)]">
                      {formatCurrency(property.deductible)} {t("deductibleShort")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <ExpenseDialog dialog={dialog} />
    </div>
  );
}
