"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Download, Building2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/lib/contexts/toast-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { cn } from "@/lib/utils/utils";
import type { FinancialReport } from "@/lib/services/financial-reports";

// Type definitions for tax and rent roll reports
interface TaxReportData {
  year: number;
  grossIncome: number;
  totalExpenses: number;
  netIncome: number;
  deductibleExpenses: Array<{ category: string; amount: number; percentage: number }>;
  quarterlyBreakdown: Array<{
    quarter: string;
    income: number;
    expenses: number;
    net: number;
  }>;
  properties: Array<{
    propertyId: string;
    propertyName: string;
    income: number;
    expenses: number;
    net: number;
  }>;
}

interface RentRollData {
  totalMonthlyRent: number;
  totalAnnualRent: number;
  occupancyRate: number;
  properties: Array<{
    propertyId: string;
    propertyName: string;
    status: string;
    monthlyRent: number;
    tenantName?: string;
    leaseEnd?: string;
  }>;
}

export function ReportsView(): React.ReactElement {
  const { success, error } = useToast();
  const t = useTranslations("reports");
  const tStatus = useTranslations("status");
  const tCategories = useTranslations("financial.categories");
  const { formatCurrency } = useCurrency();

  const [isLoading, setIsLoading] = useState(false);
  const [reportType, setReportType] = useState<"financial" | "tax" | "rent-roll">("financial");
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [taxReport, setTaxReport] = useState<TaxReportData | null>(null);
  const [rentRoll, setRentRoll] = useState<RentRollData | null>(null);

  // Date range state
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(lastOfMonth.toISOString().split("T")[0]);
  const [taxYear, setTaxYear] = useState(now.getFullYear());

  // Fetch report
  const fetchReport = React.useCallback(async () => {
    setIsLoading(true);

    try {
      let url = "/api/reports?";

      switch (reportType) {
        case "financial":
          url += `type=financial&startDate=${startDate}&endDate=${endDate}`;
          break;
        case "tax":
          url += `type=tax&year=${taxYear}`;
          break;
        case "rent-roll":
          url += "type=rent-roll";
          break;
      }

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        switch (reportType) {
          case "financial":
            setReport(data.data);
            break;
          case "tax":
            setTaxReport(data.data);
            break;
          case "rent-roll":
            setRentRoll(data.data);
            break;
        }
      } else {
        error(t("toastLoadFailed"));
      }
    } catch (err) {
      console.error("Failed to fetch report:", err);
      error(t("toastLoadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [reportType, startDate, endDate, taxYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // Download CSV
  const downloadCSV = async () => {
    try {
      const url = `/api/reports?type=financial&startDate=${startDate}&endDate=${endDate}&format=csv`;
      const response = await fetch(url);

      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `financial-report-${startDate}-to-${endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        success(t("toastDownloaded"));
      } else {
        error(t("toastDownloadFailed"));
      }
    } catch (err) {
      console.error("Failed to download:", err);
      error(t("toastDownloadFailed"));
    }
  };

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleGenerateReport = () => {
    fetchReport();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]">
            {t("heading")}
          </h2>
          <p className="text-[var(--color-muted-foreground)]">{t("subtitle")}</p>
        </div>
      </div>

      {/* Report Type Tabs */}
      <Tabs value={reportType} onValueChange={(v) => setReportType(v as typeof reportType)}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="financial">{t("tabFinancial")}</TabsTrigger>
          <TabsTrigger value="tax">{t("tabTax")}</TabsTrigger>
          <TabsTrigger value="rent-roll">{t("tabRentRoll")}</TabsTrigger>
        </TabsList>

        {/* Financial Report */}
        <TabsContent value="financial" className="space-y-6">
          {/* Controls */}
          <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label>{t("startDate")}</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("endDate")}</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <Button onClick={handleGenerateReport} disabled={isLoading}>
                  <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                  {t("generate")}
                </Button>
                <Button variant="outline" onClick={downloadCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  {t("exportCsv")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {report && (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-4">
                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("totalIncome")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-[var(--color-success)]">
                      {formatCurrency(report.income.total)}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("totalExpenses")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-[var(--color-destructive)]">
                      {formatCurrency(report.expenses.total)}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("netIncome")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={cn(
                        "text-2xl font-bold",
                        report.netIncome >= 0
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-destructive)]",
                      )}
                    >
                      {formatCurrency(report.netIncome)}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("profitMargin")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={cn(
                        "text-2xl font-bold",
                        report.profitMargin >= 0
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-destructive)]",
                      )}
                    >
                      {report.profitMargin.toFixed(1)}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Income Breakdown */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader>
                    <CardTitle className="text-[var(--color-foreground)]">
                      {t("incomeBreakdown")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--color-muted-foreground)]">{t("rent")}</span>
                        <span className="font-medium text-[var(--color-foreground)]">
                          {formatCurrency(report.income.totalRent)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--color-muted-foreground)]">
                          {t("deposits")}
                        </span>
                        <span className="font-medium text-[var(--color-foreground)]">
                          {formatCurrency(report.income.totalDeposits)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--color-muted-foreground)]">{t("other")}</span>
                        <span className="font-medium text-[var(--color-foreground)]">
                          {formatCurrency(report.income.totalOther)}
                        </span>
                      </div>
                      <div className="border-t border-[var(--color-border)] pt-3 flex justify-between items-center">
                        <span className="font-medium text-[var(--color-muted-foreground)]">
                          {t("total")}
                        </span>
                        <span className="font-bold text-[var(--color-success)]">
                          {formatCurrency(report.income.total)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader>
                    <CardTitle className="text-[var(--color-foreground)]">
                      {t("expensesByCategory")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {report.expenses.byCategory.map((cat) => (
                        <div key={cat.category} className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            {/* The stored expense category, which is a snake_case enum —
                                this listed "condominium_fees" where the Finances screen says
                                "Quotas de Condomínio" for the same expenses. */}
                            <span className="text-[var(--color-muted-foreground)]">
                              {tCategories(cat.category)}
                            </span>
                            <span className="text-xs text-[var(--color-muted-foreground)]">
                              ({cat.percentage}%)
                            </span>
                          </div>
                          <span className="font-medium text-[var(--color-foreground)]">
                            {formatCurrency(cat.amount)}
                          </span>
                        </div>
                      ))}
                      {report.expenses.byCategory.length === 0 && (
                        <p className="text-[var(--color-muted-foreground)] text-sm">
                          {t("noExpenses")}
                        </p>
                      )}
                      <div className="border-t border-[var(--color-border)] pt-3 flex justify-between items-center">
                        <span className="font-medium text-[var(--color-muted-foreground)]">
                          {t("total")}
                        </span>
                        <span className="font-bold text-[var(--color-destructive)]">
                          {formatCurrency(report.expenses.total)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Income by Property */}
              {report.income.byProperty.length > 0 && (
                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader>
                    <CardTitle className="text-[var(--color-foreground)]">
                      {t("incomeByProperty")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {report.income.byProperty.map((prop) => (
                        <div
                          key={prop.propertyId}
                          className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface)]"
                        >
                          <div className="flex items-center gap-3">
                            <Building2 className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                            <span className="text-[var(--color-foreground)]">
                              {prop.propertyName}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-[var(--color-foreground)]">
                              {formatCurrency(prop.total)}
                            </div>
                            <div className="text-xs text-[var(--color-muted-foreground)]">
                              Rent: {formatCurrency(prop.rent)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Invoice Summary */}
              <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-[var(--color-foreground)]">
                    {t("invoiceSummary")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="text-center p-4 rounded-lg bg-[var(--color-warning-muted)]">
                      <div className="text-2xl font-bold text-[var(--color-warning)]">
                        {report.invoices.summary.invoiceCount.pending}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {tStatus("pending")}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {formatCurrency(report.invoices.summary.totalPending)}
                      </div>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-[var(--color-success-muted)]">
                      <div className="text-2xl font-bold text-[var(--color-success)]">
                        {report.invoices.summary.invoiceCount.paid}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {tStatus("paid")}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {formatCurrency(report.invoices.summary.totalPaid)}
                      </div>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-[var(--color-error-muted)]">
                      <div className="text-2xl font-bold text-[var(--color-destructive)]">
                        {report.invoices.summary.invoiceCount.overdue}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {tStatus("overdue")}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {formatCurrency(report.invoices.summary.totalOverdue)}
                      </div>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-[var(--color-warning-muted)]">
                      <div className="text-2xl font-bold text-[var(--color-warning)]">
                        {formatCurrency(report.invoices.summary.totalLateFees)}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {t("lateFees")}
                      </div>
                      <div className="text-sm text-[var(--color-muted-foreground)]">
                        {t("collected")}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Tax Report */}
        <TabsContent value="tax" className="space-y-6">
          <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
            <CardContent className="pt-6">
              <div className="flex items-end gap-4">
                <div className="space-y-2">
                  <Label>{t("taxYear")}</Label>
                  <Select value={taxYear.toString()} onValueChange={(v) => setTaxYear(parseInt(v))}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2024, 2025, 2026].map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleGenerateReport} disabled={isLoading}>
                  <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                  {t("generate")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {taxReport && (
            <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
              <CardHeader>
                <CardTitle className="text-[var(--color-foreground)]">
                  Tax Year {taxReport.year}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3 mb-6">
                  <div className="text-center p-4 rounded-lg bg-[var(--color-surface)]">
                    <div className="text-2xl font-bold text-[var(--color-success)]">
                      {formatCurrency(taxReport.grossIncome)}
                    </div>
                    <div className="text-sm text-[var(--color-muted-foreground)]">
                      {t("grossIncome")}
                    </div>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-[var(--color-surface)]">
                    <div className="text-2xl font-bold text-[var(--color-destructive)]">
                      {formatCurrency(taxReport.totalExpenses)}
                    </div>
                    <div className="text-sm text-[var(--color-muted-foreground)]">
                      {t("deductibleExpenses")}
                    </div>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-[var(--color-surface)]">
                    <div className="text-2xl font-bold text-[var(--color-foreground)]">
                      {formatCurrency(taxReport.netIncome)}
                    </div>
                    <div className="text-sm text-[var(--color-muted-foreground)]">
                      {t("taxableIncome")}
                    </div>
                  </div>
                </div>

                <h4 className="font-medium text-[var(--color-muted-foreground)] mb-3">
                  {t("quarterlyBreakdown")}
                </h4>
                <div className="grid gap-3 md:grid-cols-4">
                  {(taxReport.quarterlyBreakdown || []).map((q) => (
                    <div
                      key={q.quarter}
                      className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
                    >
                      <div className="font-medium text-[var(--color-foreground)] mb-2">
                        {q.quarter}
                      </div>
                      <div className="text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-[var(--color-muted-foreground)]">
                            {t("income")}
                          </span>
                          <span className="text-[var(--color-success)]">
                            {formatCurrency(q.income)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-muted-foreground)]">
                            {t("expenses")}
                          </span>
                          <span className="text-[var(--color-destructive)]">
                            {formatCurrency(q.expenses)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-[var(--color-border)] pt-1">
                          <span className="text-[var(--color-muted-foreground)]">{t("net")}</span>
                          <span className="text-[var(--color-foreground)]">
                            {formatCurrency(q.net)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Rent Roll */}
        <TabsContent value="rent-roll" className="space-y-6">
          <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
            <CardContent className="pt-6">
              <Button onClick={handleGenerateReport} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                {t("refreshRentRoll")}
              </Button>
            </CardContent>
          </Card>

          {rentRoll && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("monthlyRent")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-[var(--color-foreground)]">
                      {formatCurrency(rentRoll.totalMonthlyRent)}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("annualRent")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-[var(--color-foreground)]">
                      {formatCurrency(rentRoll.totalAnnualRent)}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                      {t("occupancyRate")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-[var(--color-foreground)]">
                      {rentRoll.occupancyRate}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-[var(--color-card)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-[var(--color-foreground)]">
                    {t("propertyDetails")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(rentRoll.properties || []).map((prop) => (
                      <div
                        key={prop.propertyId}
                        className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
                      >
                        <div className="flex items-center gap-3">
                          <Building2 className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                          <div>
                            <div className="font-medium text-[var(--color-foreground)]">
                              {prop.propertyName}
                            </div>
                            {prop.tenantName && (
                              <div className="text-sm text-[var(--color-muted-foreground)]">
                                Tenant: {prop.tenantName}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-[var(--color-foreground)]">
                            {formatCurrency(prop.monthlyRent)}/mo
                          </div>
                          <div
                            className={cn(
                              "text-xs",
                              prop.status === "occupied"
                                ? "text-[var(--color-success)]"
                                : prop.status === "vacant"
                                  ? "text-[var(--color-warning)]"
                                  : "text-[var(--color-destructive)]",
                            )}
                          >
                            {prop.status.charAt(0).toUpperCase() + prop.status.slice(1)}
                          </div>
                          {prop.leaseEnd && (
                            <div className="text-xs text-[var(--color-muted-foreground)]">
                              Lease ends: {new Date(prop.leaseEnd).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
