"use client";

import { useState, useMemo } from "react";
import {
  DollarSign,
  Plus,
  Zap,
  Calendar as CalendarIcon,
  FileText,
  Calculator,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useTranslations } from "next-intl";
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
import { TaxCalculator, TaxCalculationResult } from "@/lib/utils/tax-calculator";
import { getExpenseCategoryColor } from "@/lib/design-tokens";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { csrfHeaders } from "@/lib/utils/api-client";

export function FinancialsView(): React.ReactElement {
  const { state, addExpense, addReceipt } = useApp();
  const { properties, receipts, expenses, loading } = state;
  const { formatCurrency } = useCurrency();
  const { success: toastSuccess, error: toastError } = useToast();
  const t = useTranslations("financial");

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
      create: "Expense recorded successfully!",
      update: "Expense updated successfully!",
    },
    errorMessage: "Failed to save expense.",
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
    category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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
      monthLabel: new Date(key + "-01").toLocaleString("default", {
        month: "long",
        year: "numeric",
      }),
      monthTotal: recs.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0),
      receipts: recs,
    }));
  }, [metrics.filteredReceipts, receiptStatusFilter]);

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
      toastError("Failed to generate receipts.");
    } finally {
      setIsBulkGenerating(false);
    }
  };

  return (
    <>
      {loading ? (
        <LoadingState variant="cards" count={6} />
      ) : receipts.length === 0 && expenses.length === 0 ? (
        <div className="space-y-6">
          <PageHeader title="Accounts" description="Track income, expenses, and cash flow" />
          <EmptyStateIllustration
            type="expenses"
            title="No financial data yet"
            description="Start by adding receipts or expenses to track your cash flow"
          />
        </div>
      ) : (
        <div className="space-y-6">
          <PageHeader title="Accounts" description="Track income, expenses, and cash flow">
            <Select value={timeRange} onValueChange={setTimeRange}>
              {/* Content-sized with a floor. At a fixed 150px the value overflowed its own box
                  by 3px — enough for the audit to count it as an unreachable clip, and a sign
                  the width was guessed rather than measured. */}
              <SelectTrigger className="min-w-[150px] w-auto" aria-label={t("timeRange")}>
                <CalendarIcon className="w-4 h-4 shrink-0" />
                <SelectValue placeholder={t("timeRange")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={handleBulkGenerate}
              disabled={isBulkGenerating}
              className="flex items-center gap-2"
            >
              <Zap className="w-4 h-4" />
              {isBulkGenerating ? "Generating…" : t("bulkGenerate")}
            </Button>

            <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
              <DialogTrigger asChild>
                <Button onClick={dialog.openDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Expense
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[var(--color-card-solid)] border-[var(--color-border)] sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Record Expense</DialogTitle>
                  <DialogDescription>
                    Add a new property expense to track your spending
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={dialog.handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="property">Property</Label>
                      <Select
                        value={dialog.formData.propertyId}
                        onValueChange={(val) => dialog.updateFormData({ propertyId: val })}
                      >
                        <SelectTrigger
                          id="property"
                          className={
                            dialog.formErrors.propertyId ? "border-[var(--color-destructive)]" : ""
                          }
                        >
                          <SelectValue placeholder="Select property" />
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
                      <Label htmlFor="category">Category</Label>
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
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {dialog.formErrors.category && (
                        <p className="text-sm text-destructive">{dialog.formErrors.category}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Amount ($)</Label>
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
                      <Label htmlFor="date">Date</Label>
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
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={dialog.formData.description || ""}
                      onChange={(e) => dialog.updateFormData({ description: e.target.value })}
                      placeholder="Details about the expense..."
                    />
                  </div>

                  {/* Recurring expense toggle */}
                  <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="isRecurring" className="text-sm font-medium">
                          Repeating expense
                        </Label>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          Automatically generate this expense on a schedule
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
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="recurrenceRule">Repeat</Label>
                            <Select
                              value={dialog.formData.recurrenceRule ?? "monthly"}
                              onValueChange={(val) =>
                                dialog.updateFormData({
                                  recurrenceRule: val as (typeof RECURRENCE_RULES)[number],
                                })
                              }
                            >
                              <SelectTrigger id="recurrenceRule">
                                <SelectValue placeholder="Select frequency" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="quarterly">Quarterly</SelectItem>
                                <SelectItem value="annual">Annually</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="recurrenceDay">Generate on day</Label>
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
                            Stop after{" "}
                            <span className="text-[var(--color-muted-foreground)] font-normal">
                              (optional — leave blank for never)
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
                      Cancel
                    </Button>
                    <Button type="submit" loading={dialog.isSubmitting}>
                      Create Expense
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </PageHeader>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  Total Income
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-[var(--color-success)]" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[var(--color-foreground)] tabular-nums">
                  {formatCurrency(metrics.totalIncome)}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  From rent and deposits
                </p>
              </CardContent>
            </Card>
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  Total Expenses
                </CardTitle>
                <TrendingDown className="h-4 w-4 text-[var(--color-destructive)]" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-[var(--color-foreground)] tabular-nums">
                  {formatCurrency(metrics.totalExpenses)}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Maintenance, repairs, etc.
                </p>
              </CardContent>
            </Card>
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  Net Income
                </CardTitle>
                <DollarSign
                  className={cn(
                    "h-4 w-4",
                    metrics.netProfit >= 0
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-destructive)]",
                  )}
                />
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    metrics.netProfit >= 0
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-destructive)]",
                  )}
                >
                  {formatCurrency(metrics.netProfit)}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">Cash flow for period</p>
              </CardContent>
            </Card>
          </div>

          {/* Tax Calculation Section */}
          {timeRange === "year" && taxCalculation && (
            <Card className="bg-[var(--color-card-solid)] border-[var(--color-border)]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-[var(--color-foreground)] flex items-center gap-2">
                      <Calculator className="h-5 w-5" />
                      Tax Calculation - {selectedCountry === "PT" ? "Portugal" : "Spain"}
                    </CardTitle>
                    <CardDescription>Estimated tax liability for rental income</CardDescription>
                  </div>
                  <Select
                    value={selectedCountry}
                    onValueChange={(value: "PT" | "ES") => setSelectedCountry(value)}
                  >
                    <SelectTrigger className="w-32" aria-label={t("filterCountry")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PT">Portugal</SelectItem>
                      <SelectItem value="ES">Spain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      Gross Income
                    </Label>
                    <div className="text-lg font-semibold text-[var(--color-foreground)] tabular-nums">
                      {formatCurrency(taxCalculation.grossIncome)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      Taxable Income
                    </Label>
                    <div className="text-lg font-semibold text-[var(--color-foreground)] tabular-nums">
                      {formatCurrency(taxCalculation.taxableIncome)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      Tax Amount
                    </Label>
                    <div className="text-lg font-semibold text-[var(--color-destructive)] tabular-nums">
                      {formatCurrency(taxCalculation.taxAmount)}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {taxCalculation.effectiveRate.toFixed(1)}% effective rate
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      Quarterly Payment
                    </Label>
                    <div className="text-base font-semibold text-[var(--color-warning)] tabular-nums">
                      {formatCurrency(taxCalculation.quarterlyPayment)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      Annual Settlement
                    </Label>
                    <div className="text-base font-semibold text-[var(--color-warning)] tabular-nums">
                      {formatCurrency(taxCalculation.annualSettlement)}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Label className="text-sm font-medium text-[var(--color-muted-foreground)]">
                    Deductions Applied
                  </Label>
                  <div className="mt-2 space-y-1">
                    {Object.entries(taxCalculation.deductions.breakdown).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-[var(--color-muted-foreground)] capitalize">
                          {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                        </span>
                        <span className="text-[var(--color-foreground)]">
                          {formatCurrency(value)}
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-[var(--color-border)] pt-1 mt-2 flex justify-between font-medium">
                      <span className="text-[var(--color-muted-foreground)]">Total Deductions</span>
                      <span className="text-[var(--color-success)]">
                        {formatCurrency(taxCalculation.deductions.total)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-[var(--color-popover)] rounded-md">
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    <strong>Note:</strong> This is an estimate based on{" "}
                    {selectedCountry === "PT" ? "Portugal" : "Spain"} tax regulations for 2024.
                    Consult a tax professional for accurate calculations and compliance with current
                    laws.
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
                  <CardTitle>Income &amp; Receipts</CardTitle>
                  <CardDescription>Rent payments received</CardDescription>
                </div>
                <Select
                  value={receiptStatusFilter}
                  onValueChange={(v) => setReceiptStatusFilter(v as "all" | "paid" | "pending")}
                >
                  <SelectTrigger className="w-32" aria-label={t("filterReceiptStatus")}>
                    <SelectValue placeholder={t("filterReceiptStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {groupedReceipts.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
                    No income records found
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
                              {receipt.status}
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
                <CardTitle>Expenses</CardTitle>
                <CardDescription>Latest tracked property costs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {metrics.filteredExpenses.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
                      No expense records found
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
                                {expense.propertyName ?? "Unknown Property"} &bull;{" "}
                                {new Date(expense.date).toLocaleDateString()}
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
