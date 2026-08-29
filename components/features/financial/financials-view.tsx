"use client";

import { useState, useMemo } from "react";
import { Plus, Zap, Calendar as CalendarIcon, FileText, Calculator } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import {
  expenseSchema,
  EXPENSE_CATEGORIES,
  RECURRENCE_RULES,
  type ExpenseFormData,
} from "@/lib/schemas/expense.schema";
import { cn } from "@/lib/utils/utils";
import { countryLabel } from "@/lib/design/country-themes";
import { TaxCalculator, TaxCalculationResult } from "@/lib/utils/tax-calculator";
import { getExpenseCategoryColor } from "@/lib/design-tokens";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import { csrfHeaders } from "@/lib/utils/api-client";

/**
 * Expense categories have had translated labels under `financial.categories` all along — this
 * view was de-underscoring the enum value instead, so a Portuguese reader read "Condominium
 * Fees". A stored row can still carry a category outside the current enum (older data, a renamed
 * key), and asking the catalogue for a key it does not have logs an error and renders the key, so
 * anything unrecognised keeps the old title-case transform.
 */
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(EXPENSE_CATEGORIES);

/**
 * The tax calculator's deduction breakdown is a closed set of camelCase keys. It was rendered by
 * de-camelCasing them, which is an English sentence built at runtime — and one of them,
 * `stressedZoneTier`, is a regime NAME cast to a number, so it reached `formatCurrency` and
 * printed "NaN €". Known keys get a translated label; anything else is skipped rather than
 * guessed at.
 */
const DEDUCTION_KEYS = [
  "expenses",
  "maxDeductible",
  "allowedDeduction",
  "mortgageInterest",
  "communityFees",
  "stressedZoneReduction",
] as const;

export function FinancialsView(): React.ReactElement {
  const { state, addExpense, addReceipt } = useApp();
  const { properties, receipts, expenses, loading } = state;
  const { formatCurrency, currencySymbol } = useCurrency();
  const { success: toastSuccess, error: toastError } = useToast();
  const t = useTranslations("financial");
  const tCategories = useTranslations("financial.categories");
  const tStatus = useTranslations("status");
  const tActions = useTranslations("actions");
  const locale = useLocale();

  const [timeRange, setTimeRange] = useState("month"); // all, month, year
  const [selectedCountry, setSelectedCountry] = useState<"PT" | "ES">("PT");
  const [receiptStatusFilter, setReceiptStatusFilter] = useState<"all" | "paid" | "pending">("all");
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);

  const dialog = useFormDialog<ExpenseFormData>({
    schema: expenseSchema,
    initialData: {
      propertyId: "",
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      category: "other" as const,
      description: "",
      isDeductible: true,
      isRecurring: false,
      recurrenceDay: 1,
      recurrenceEnd: null,
    },
    onSubmit: async (data) => {
      await addExpense(data);
    },
    successMessage: {
      create: t("expenseForm.toastCreated"),
      update: t("expenseForm.toastUpdated"),
    },
    errorMessage: t("expenseForm.toastFailed"),
  });

  // Enhanced Calculations with trends
  const metrics = useMemo(() => {
    let filteredReceipts = receipts;
    let filteredExpenses = expenses;
    let previousReceipts = receipts;
    let previousExpenses = expenses;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Previous period for trend calculation
    const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    if (timeRange === "month") {
      filteredReceipts = receipts.filter((r) => {
        const date = new Date(r.date);
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
      });
      filteredExpenses = expenses.filter((e) => {
        const date = new Date(e.date);
        return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
      });

      // Previous month for trend
      previousReceipts = receipts.filter((r) => {
        const date = new Date(r.date);
        return date.getMonth() === previousMonth && date.getFullYear() === previousYear;
      });
      previousExpenses = expenses.filter((e) => {
        const date = new Date(e.date);
        return date.getMonth() === previousMonth && date.getFullYear() === previousYear;
      });
    } else if (timeRange === "year") {
      filteredReceipts = receipts.filter((r) => new Date(r.date).getFullYear() === currentYear);
      filteredExpenses = expenses.filter((e) => new Date(e.date).getFullYear() === currentYear);

      // Previous year for trend
      previousReceipts = receipts.filter((r) => new Date(r.date).getFullYear() === currentYear - 1);
      previousExpenses = expenses.filter((e) => new Date(e.date).getFullYear() === currentYear - 1);
    }

    const totalIncome = filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const netProfit = totalIncome - totalExpenses;

    // Previous period totals
    const prevIncome = previousReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const prevExpenses = previousExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const prevNetProfit = prevIncome - prevExpenses;

    // Calculate trends
    const incomeTrend = prevIncome > 0 ? ((totalIncome - prevIncome) / prevIncome) * 100 : 0;
    const expensesTrend =
      prevExpenses > 0 ? ((totalExpenses - prevExpenses) / prevExpenses) * 100 : 0;
    const profitTrend =
      prevNetProfit !== 0 ? ((netProfit - prevNetProfit) / Math.abs(prevNetProfit)) * 100 : 0;

    // Group expenses by category
    const expensesByCategory = filteredExpenses.reduce(
      (acc, expense) => {
        acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Monthly revenue trend (last 6 months)
    const monthlyRevenue = [];
    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(currentYear, currentMonth - i, 1);
      const monthReceipts = receipts.filter((r) => {
        const receiptDate = new Date(r.date);
        return (
          receiptDate.getMonth() === targetDate.getMonth() &&
          receiptDate.getFullYear() === targetDate.getFullYear()
        );
      });

      monthlyRevenue.push({
        label: targetDate.toLocaleString("default", { month: "short" }),
        value: monthReceipts.reduce((sum, r) => sum + r.amount, 0),
      });
    }

    return {
      totalIncome,
      totalExpenses,
      netProfit,
      profitMargin: totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0,
      incomeTrend,
      expensesTrend,
      profitTrend,
      expensesByCategory,
      monthlyRevenue,
      totalProperties: properties.length,
      avgRevenuePerProperty: properties.length > 0 ? totalIncome / properties.length : 0,
      filteredReceipts,
      filteredExpenses,
    };
  }, [receipts, expenses, properties, timeRange]);

  const getCategoryColor = (category: string) => getExpenseCategoryColor(category);

  const formatCategoryLabel = (category: string) =>
    KNOWN_CATEGORIES.has(category)
      ? tCategories(category)
      : category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Group receipts by month for table display
  const groupedReceipts = useMemo(() => {
    const filtered =
      receiptStatusFilter === "all"
        ? metrics.filteredReceipts
        : metrics.filteredReceipts.filter((r) => r.status === receiptStatusFilter);
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const groups: Record<string, typeof sorted> = {};
    sorted.forEach((r) => {
      const key = r.date.substring(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    return Object.entries(groups).map(([key, recs]) => ({
      key,
      // `locale`, not "default". "default" is the runtime's locale, which is the container's —
      // so a Portuguese reader got "January 2026" as a section heading inside a translated page.
      monthLabel: new Date(key + "-01").toLocaleString(locale, {
        month: "long",
        year: "numeric",
      }),
      monthTotal: recs.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0),
      receipts: recs,
    }));
  }, [metrics.filteredReceipts, receiptStatusFilter, locale]);

  // Prepare chart data
  const _expenseCategoryData = Object.entries(metrics.expensesByCategory).map(
    ([category, amount]) => ({
      label: category.charAt(0).toUpperCase() + category.slice(1),
      value: amount,
      color: getCategoryColor(category),
    }),
  );

  // Tax Calculations
  const taxCalculation = useMemo((): TaxCalculationResult | null => {
    if (timeRange !== "year") return null;

    const annualIncome = metrics.totalIncome;
    const annualExpenses = metrics.totalExpenses;

    try {
      return TaxCalculator.calculateTax({
        country: selectedCountry,
        regime: selectedCountry === "PT" ? "portugal_rendimentos" : "spain_inmuebles",
        annualRentalIncome: annualIncome,
        deductibleExpenses: annualExpenses,
      });
    } catch (error) {
      console.error("Tax calculation error:", error);
      return null;
    }
  }, [metrics, selectedCountry, timeRange]);

  const categories = EXPENSE_CATEGORIES;

  const handleBulkGenerate = async () => {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    setIsBulkGenerating(true);
    try {
      const res = await fetch("/api/receipts/bulk", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ month }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = (errData as { error?: string })?.error ?? res.statusText;
        toastError(msg);
        return;
      }
      const data = (await res.json()) as {
        data: { generated: import("@/lib/types").Receipt[]; skipped: number; errors: string[] };
      };
      const { generated, skipped } = data.data;
      for (const receipt of generated) {
        await addReceipt(receipt);
      }
      if (generated.length === 0) {
        toastSuccess(t("bulkGenerateEmpty"));
      } else {
        toastSuccess(t("bulkGenerateSuccess", { count: generated.length, skipped }));
      }
    } catch {
      toastError(t("bulkGenerateFailed"));
    } finally {
      setIsBulkGenerating(false);
    }
  };

  return (
    <>
      {loading ? (
        <LoadingState variant="cards" count={6} />
      ) : receipts.length === 0 && expenses.length === 0 ? (
        <div className="space-y-4">
          <h2 className="mono-label">{t("title")}</h2>
          <EmptyStateIllustration
            type="expenses"
            title={t("noFinancialData")}
            description={t("noFinancialDataDesc")}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* A section heading, not a page title.

              This was a `PageHeader` reading "Accounts" — an untranslated `h2` at `text-3xl`,
              sitting directly under the container's real page title "Pagamentos". Declutter rule
              1 allows one heading per screen, and the tab label already names this one.

              The three stat tiles that used to follow it are gone for rules 2 and 4. The tab
              container renders four bordered tiles of its own immediately above; two stat rows on
              one screen is exactly what rule 2 forbids, and these three counts are read, not
              acted on, so rule 4 puts them in a subtitle line — the Portfolio pattern. They are
              still all three there, still period-scoped by the range control, and the screen
              starts ~180px higher. */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="mono-label">{t("title")}</h2>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {t("totalIncome")}{" "}
                <span className="tabular-nums text-[var(--color-foreground)]">
                  {formatCurrency(metrics.totalIncome)}
                </span>
                {" · "}
                {t("totalExpenses")}{" "}
                <span className="tabular-nums text-[var(--color-foreground)]">
                  {formatCurrency(metrics.totalExpenses)}
                </span>
                {" · "}
                {t("netIncome")}{" "}
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    metrics.netProfit >= 0
                      ? "text-[var(--semantic-success-readable)]"
                      : "text-[var(--semantic-danger-readable)]",
                  )}
                >
                  {formatCurrency(metrics.netProfit)}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={timeRange} onValueChange={setTimeRange}>
                {/* Content-sized with a floor. At a fixed 150px the value overflowed its own box
                  by 3px — enough for the audit to count it as an unreachable clip, and a sign
                  the width was guessed rather than measured. */}
                <SelectTrigger className="min-w-[150px] w-auto" aria-label={t("timeRange")}>
                  <CalendarIcon className="w-4 h-4 shrink-0" />
                  <SelectValue placeholder={t("timeRange")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTime")}</SelectItem>
                  <SelectItem value="month">{t("thisMonth")}</SelectItem>
                  <SelectItem value="year">{t("thisYear")}</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={handleBulkGenerate}
                disabled={isBulkGenerating}
                className="flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {isBulkGenerating ? t("generating") : t("bulkGenerate")}
              </Button>

              <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
                <DialogTrigger asChild>
                  <Button onClick={dialog.openDialog} className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    {t("addExpense")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[var(--color-card-solid)] border-[var(--color-border)] sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>{t("recordExpense")}</DialogTitle>
                    <DialogDescription>{t("addExpenseDesc")}</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={dialog.handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="property">{t("expenseForm.property")}</Label>
                        <Select
                          value={dialog.formData.propertyId}
                          onValueChange={(val) => dialog.updateFormData({ propertyId: val })}
                        >
                          <SelectTrigger
                            id="property"
                            className={
                              dialog.formErrors.propertyId
                                ? "border-[var(--color-destructive)]"
                                : ""
                            }
                          >
                            <SelectValue placeholder={t("expenseForm.selectProperty")} />
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
                        <Label htmlFor="category">{t("expenseForm.category")}</Label>
                        <Select
                          value={dialog.formData.category}
                          onValueChange={(val) =>
                            dialog.updateFormData({ category: val as ExpenseFormData["category"] })
                          }
                        >
                          <SelectTrigger
                            id="category"
                            className={
                              dialog.formErrors.category ? "border-[var(--color-destructive)]" : ""
                            }
                          >
                            <SelectValue placeholder={t("expenseForm.selectCategory")} />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c} value={c}>
                                {tCategories(c)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {dialog.formErrors.category && (
                          <p className="text-sm text-destructive">{dialog.formErrors.category}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="amount">
                          {t("expenseForm.amount", { symbol: currencySymbol })}
                        </Label>
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          value={dialog.formData.amount || ""}
                          onChange={(e) =>
                            dialog.updateFormData({
                              amount: parseFloat(e.target.value),
                            })
                          }
                          className={
                            dialog.formErrors.amount ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.amount && (
                          <p className="text-sm text-destructive">{dialog.formErrors.amount}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="date">{t("expenseForm.date")}</Label>
                        <Input
                          id="date"
                          type="date"
                          value={dialog.formData.date}
                          onChange={(e) => dialog.updateFormData({ date: e.target.value })}
                          className={
                            dialog.formErrors.date ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.date && (
                          <p className="text-sm text-destructive">{dialog.formErrors.date}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">{t("expenseForm.description")}</Label>
                      <Textarea
                        id="description"
                        value={dialog.formData.description || ""}
                        onChange={(e) => dialog.updateFormData({ description: e.target.value })}
                        placeholder={t("expenseForm.descriptionPlaceholder")}
                      />
                    </div>

                    {/* Recurring expense toggle */}
                    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="isRecurring" className="text-sm font-medium">
                            {t("isRecurring")}
                          </Label>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {t("recurringToggleDesc")}
                          </p>
                        </div>
                        <Switch
                          id="isRecurring"
                          checked={!!dialog.formData.isRecurring}
                          onCheckedChange={(checked) =>
                            dialog.updateFormData({
                              isRecurring: checked,
                              recurrenceRule: checked ? "monthly" : undefined,
                              recurrenceDay: checked ? 1 : undefined,
                              recurrenceEnd: null,
                            })
                          }
                        />
                      </div>

                      {dialog.formData.isRecurring && (
                        <div className="space-y-3 pl-1">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="recurrenceRule">{t("recurrenceRule")}</Label>
                              <Select
                                value={dialog.formData.recurrenceRule ?? "monthly"}
                                onValueChange={(val) =>
                                  dialog.updateFormData({
                                    recurrenceRule: val as (typeof RECURRENCE_RULES)[number],
                                  })
                                }
                              >
                                <SelectTrigger id="recurrenceRule">
                                  <SelectValue placeholder={t("expenseForm.selectFrequency")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="monthly">{t("recurrenceMonthly")}</SelectItem>
                                  <SelectItem value="quarterly">
                                    {t("recurrenceQuarterly")}
                                  </SelectItem>
                                  <SelectItem value="annual">{t("recurrenceAnnual")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="recurrenceDay">{t("recurrenceDay")}</Label>
                              <Input
                                id="recurrenceDay"
                                type="number"
                                min={1}
                                max={28}
                                value={dialog.formData.recurrenceDay ?? 1}
                                onChange={(e) =>
                                  dialog.updateFormData({
                                    recurrenceDay: parseInt(e.target.value, 10) || undefined,
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="recurrenceEnd">
                              {t("recurrenceEnd")}{" "}
                              <span className="text-[var(--color-muted-foreground)] font-normal">
                                ({t("recurrenceEndPlaceholder")})
                              </span>
                            </Label>
                            <Input
                              id="recurrenceEnd"
                              type="date"
                              value={dialog.formData.recurrenceEnd ?? ""}
                              onChange={(e) =>
                                dialog.updateFormData({
                                  recurrenceEnd: e.target.value || null,
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
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
            </div>
          </div>

          {/* Tax Calculation Section */}
          {timeRange === "year" && taxCalculation && (
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-[var(--color-foreground)] flex items-center gap-2">
                      <Calculator className="h-5 w-5" />
                      {t("tax.heading", { country: countryLabel(selectedCountry, locale) })}
                    </CardTitle>
                    <CardDescription>{t("tax.description")}</CardDescription>
                  </div>
                  <Select
                    value={selectedCountry}
                    onValueChange={(value: "PT" | "ES") => setSelectedCountry(value)}
                  >
                    {/* Content-sized, like the range control above: `w-32` was measured against
                        "Portugal" and has no room for a longer exonym. */}
                    <SelectTrigger className="min-w-[8rem] w-auto" aria-label={t("filterCountry")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PT">{countryLabel("PT", locale)}</SelectItem>
                      <SelectItem value="ES">{countryLabel("ES", locale)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("tax.grossIncome")}
                    </Label>
                    <div className="text-lg font-semibold text-[var(--color-foreground)] tabular-nums">
                      {formatCurrency(taxCalculation.grossIncome)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("tax.taxableIncome")}
                    </Label>
                    <div className="text-lg font-semibold text-[var(--color-foreground)] tabular-nums">
                      {formatCurrency(taxCalculation.taxableIncome)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("tax.taxAmount")}
                    </Label>
                    <div className="text-lg font-semibold text-[var(--color-destructive)] tabular-nums">
                      {formatCurrency(taxCalculation.taxAmount)}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {t("tax.effectiveRate", { rate: taxCalculation.effectiveRate.toFixed(1) })}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("tax.quarterlyPayment")}
                    </Label>
                    <div className="text-base font-semibold text-[var(--color-warning)] tabular-nums">
                      {formatCurrency(taxCalculation.quarterlyPayment)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("tax.annualSettlement")}
                    </Label>
                    <div className="text-base font-semibold text-[var(--color-warning)] tabular-nums">
                      {formatCurrency(taxCalculation.annualSettlement)}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                    {t("tax.deductionsApplied")}
                  </Label>
                  <div className="mt-2 space-y-1">
                    {DEDUCTION_KEYS.filter((key) =>
                      Number.isFinite(taxCalculation.deductions.breakdown[key]),
                    ).map((key) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-[var(--color-muted-foreground)]">
                          {t(`tax.deduction.${key}`)}
                        </span>
                        <span className="text-[var(--color-foreground)] tabular-nums">
                          {formatCurrency(taxCalculation.deductions.breakdown[key])}
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-[var(--color-border)] pt-1 mt-2 flex justify-between font-medium">
                      <span className="text-[var(--color-muted-foreground)]">
                        {t("tax.totalDeductions")}
                      </span>
                      <span className="text-[var(--color-success)] tabular-nums">
                        {formatCurrency(taxCalculation.deductions.total)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-[var(--color-popover)] rounded-md">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    <strong>{t("tax.noteLabel")}:</strong>{" "}
                    {t("tax.note", { country: countryLabel(selectedCountry, locale) })}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {/* Income & Receipts table */}
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{t("incomeAndReceipts")}</CardTitle>
                  <CardDescription>{t("incomeAndReceiptsDesc")}</CardDescription>
                </div>
                <Select
                  value={receiptStatusFilter}
                  onValueChange={(v) => setReceiptStatusFilter(v as "all" | "paid" | "pending")}
                >
                  <SelectTrigger
                    className="min-w-[8rem] w-auto"
                    aria-label={t("filterReceiptStatus")}
                  >
                    <SelectValue placeholder={t("filterReceiptStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tStatus("all")}</SelectItem>
                    <SelectItem value="paid">{tStatus("paid")}</SelectItem>
                    <SelectItem value="pending">{tStatus("pending")}</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {groupedReceipts.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
                    {t("noIncomeRecords")}
                  </p>
                ) : (
                  groupedReceipts.map(({ key, monthLabel, monthTotal, receipts: monthRecs }) => (
                    <div key={key} className="mb-5">
                      <div className="flex items-center justify-between mb-2 pb-1 border-b border-[var(--color-border)]">
                        <h4 className="text-sm font-semibold text-[var(--color-muted-foreground)]">
                          {monthLabel}
                        </h4>
                        <span className="text-sm font-semibold text-[var(--color-success)] tabular-nums">
                          {formatCurrency(monthTotal)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {monthRecs.map((receipt) => (
                          <div
                            key={receipt.id}
                            className="flex items-center gap-3 text-sm py-1.5 border-b border-[var(--color-border)]/60 last:border-0"
                          >
                            <span className="text-[var(--color-muted-foreground)] text-xs font-mono w-28 shrink-0">
                              {receipt.number ?? receipt.id.slice(0, 8)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[var(--color-foreground)] truncate">
                                {receipt.tenantName}
                              </p>
                              <p className="text-[var(--color-muted-foreground)] text-xs truncate">
                                {receipt.propertyName}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
                                receipt.status === "paid"
                                  ? "bg-[var(--color-success-muted)] text-[var(--color-success)]"
                                  : "bg-[var(--color-warning-muted)] text-[var(--color-warning)]",
                              )}
                            >
                              {tStatus(receipt.status)}
                            </span>
                            <span
                              className={cn(
                                "font-semibold text-sm shrink-0 tabular-nums",
                                receipt.status === "paid"
                                  ? "text-[var(--color-success)]"
                                  : "text-[var(--color-warning)]",
                              )}
                            >
                              {formatCurrency(receipt.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Expenses */}
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader>
                <CardTitle>{t("expensesHeading")}</CardTitle>
                <CardDescription>{t("expensesDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {metrics.filteredExpenses.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
                      {t("noExpenseRecords")}
                    </p>
                  ) : (
                    metrics.filteredExpenses
                      .slice()
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map((expense) => (
                        <div key={expense.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-[var(--color-error-muted)] rounded-full shrink-0">
                              <FileText className="w-4 h-4 text-[var(--color-destructive)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[var(--color-foreground)]">
                                {formatCategoryLabel(expense.category)}
                              </p>
                              <p className="text-xs text-[var(--color-muted-foreground)] truncate">
                                {expense.propertyName ?? t("unknownProperty")} &bull;{" "}
                                {new Date(expense.date).toLocaleDateString(locale)}
                              </p>
                            </div>
                          </div>
                          <div className="text-sm font-bold text-[var(--color-destructive)] shrink-0 tabular-nums">
                            -{formatCurrency(expense.amount)}
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
