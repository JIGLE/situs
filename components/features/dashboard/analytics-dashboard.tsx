"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, BarChart, DonutChart, AreaChart } from "@/components/ui/charts";
import { ChartWidget, ListWidget } from "@/components/ui/dashboard-widgets";
import {
  KPICard,
  OccupancyGauge,
  LeaseExpirationTimeline,
  MaintenanceStatusCard,
  PropertyPerformanceTable,
  QuickStatsRow,
} from "@/components/ui/analytics-widgets";
import { LeaseCalendar } from "@/components/ui/lease-calendar";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useApp } from "@/lib/contexts/app-context";
import { tokens, getPropertyTypeColor } from "@/lib/design-tokens";
import {
  Building2,
  Users,
  DollarSign,
  TrendingUp,
  Home,
  FileText,
  AlertTriangle,
  Calendar,
  PieChart,
  RefreshCw,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Receipt,
  Clock,
} from "lucide-react";
import type {
  KPIMetrics,
  RevenueByMonth,
  PropertyPerformance,
  LeaseExpiration,
  MaintenanceStats,
  Activity,
} from "@/lib/services/analytics-service";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const getMonthLabel = (date: Date): string => MONTH_LABELS[date.getMonth()] || "";

export type AnalyticsDashboardProps = Record<string, never>;

// Transform lease expirations to calendar events
function transformToCalendarEvents(leases: LeaseExpiration[]) {
  return leases.map((lease) => ({
    id: lease.leaseId,
    tenantName: lease.tenantName,
    propertyName: lease.propertyName,
    unitNumber: lease.unitNumber,
    date: lease.endDate,
    type: "expiration" as const,
    status: lease.status,
    monthlyRent: lease.monthlyRent,
  }));
}

export function AnalyticsDashboard(): React.ReactElement {
  const t = useTranslations("analytics");
  const locale = useLocale();
  const tActions = useTranslations("actions");
  const tNav = useTranslations("navigation");
  const tDash = useTranslations("dashboard");
  const tCharts = useTranslations("charts");
  const tInsights = useTranslations("insights");
  const { state } = useApp();
  const { properties, tenants, receipts, leases, expenses } = state;
  const { formatCurrency } = useCurrency();

  // State for analytics data
  const [isLoading, setIsLoading] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("overview");

  // Calculate KPIs from local state
  const kpis = React.useMemo((): KPIMetrics => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const totalProperties = properties.length;
    // Each property counts as 1 unit (simplification for now)
    const totalUnits = totalProperties;
    const occupiedUnits = properties.filter((p) => p.status === "occupied").length;
    const vacantUnits = totalUnits - occupiedUnits;
    const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;

    const totalTenants = tenants.length;
    // Consider tenants with current or future lease end date as active
    const activeTenants = tenants.filter((t) => {
      const leaseEnd = new Date(t.leaseEnd);
      return leaseEnd >= now;
    }).length;

    const monthlyReceipts = receipts.filter(
      (r) => r.status === "paid" && new Date(r.date) >= startOfMonth,
    );
    const monthlyRevenue = monthlyReceipts.reduce((sum, r) => sum + r.amount, 0);

    const yearlyReceipts = receipts.filter(
      (r) => r.status === "paid" && new Date(r.date) >= startOfYear,
    );
    const yearlyRevenue = yearlyReceipts.reduce((sum, r) => sum + r.amount, 0);

    // Calculate expenses from actual data
    const yearlyExpenses = expenses.filter((e) => new Date(e.date) >= startOfYear);
    const totalExpenses = yearlyExpenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = yearlyRevenue - totalExpenses;

    // For overdue, we check pending receipts older than 30 days
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const overdueReceipts = receipts.filter(
      (r) => r.status === "pending" && new Date(r.date) < thirtyDaysAgo,
    );
    const overduePayments = overdueReceipts.length;
    const overdueAmount = overdueReceipts.reduce((sum, r) => sum + r.amount, 0);

    const activeLeases = leases?.filter((l) => l.status === "active") || [];
    const averageRent =
      activeLeases.length > 0
        ? activeLeases.reduce((sum, l) => sum + (l.monthlyRent || 0), 0) / activeLeases.length
        : 0;

    const allMonthlyReceipts = receipts.filter((r) => new Date(r.date) >= startOfMonth);
    const collectionRate =
      allMonthlyReceipts.length > 0
        ? (monthlyReceipts.length / allMonthlyReceipts.length) * 100
        : 100;

    return {
      totalProperties,
      totalUnits,
      occupiedUnits,
      vacantUnits,
      occupancyRate,
      totalTenants,
      activeTenants,
      monthlyRevenue,
      yearlyRevenue,
      totalExpenses,
      netIncome,
      overduePayments,
      overdueAmount,
      averageRent,
      collectionRate,
    };
  }, [properties, tenants, receipts, leases, expenses]);

  // Calculate revenue trend (last 6 months)
  const revenueByMonth = React.useMemo((): RevenueByMonth[] => {
    const result: RevenueByMonth[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);

      const monthReceipts = receipts.filter((r) => {
        const date = new Date(r.date);
        return date >= targetDate && date <= endDate && r.status === "paid";
      });

      const monthExpenses = expenses.filter((e) => {
        const date = new Date(e.date);
        return date >= targetDate && date <= endDate;
      });

      const revenue = monthReceipts.reduce((sum, r) => sum + r.amount, 0);
      const monthExpenseTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

      result.push({
        month: getMonthLabel(targetDate),
        year: targetDate.getFullYear(),
        revenue,
        expenses: monthExpenseTotal,
        netIncome: revenue - monthExpenseTotal,
      });
    }

    return result;
  }, [receipts, expenses]);

  // Calculate lease expirations
  const leaseExpirations = React.useMemo((): LeaseExpiration[] => {
    if (!leases) return [];

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);

    return leases
      .filter((lease) => {
        const endDate = new Date(lease.endDate);
        return lease.status === "active" && endDate <= futureDate;
      })
      .map((lease) => {
        const endDate = new Date(lease.endDate);
        const daysUntilExpiration = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        let status: LeaseExpiration["status"] = "healthy";
        if (daysUntilExpiration < 0) status = "expired";
        else if (daysUntilExpiration <= 30) status = "critical";
        else if (daysUntilExpiration <= 60) status = "warning";

        const tenant = tenants.find((t) => t.id === lease.tenantId);
        const property = properties.find((p) => p.id === lease.propertyId);

        return {
          leaseId: lease.id,
          tenantName: tenant?.name || "Unknown",
          propertyName: property?.name || "Unknown",
          unitNumber: "N/A", // Simplified - no unit number in Lease type
          endDate: lease.endDate,
          daysUntilExpiration,
          monthlyRent: lease.monthlyRent || 0,
          status,
        };
      })
      .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
  }, [leases, tenants, properties]);

  // Calculate property performance
  const propertyPerformance = React.useMemo((): PropertyPerformance[] => {
    return properties.map((property) => {
      // Each property counts as 1 unit
      const totalUnitsCount = 1;
      const occupiedUnitsCount = property.status === "occupied" ? 1 : 0;
      const occupancyRate = occupiedUnitsCount * 100;

      const propertyReceipts = receipts.filter(
        (r) => r.propertyId === property.id && r.status === "paid",
      );
      const yearlyRevenue = propertyReceipts.reduce((sum, r) => sum + r.amount, 0);
      const monthlyRevenue = yearlyRevenue / 12;
      const propertyExpenses = expenses.filter((e) => e.propertyId === property.id);
      const expenseTotal = propertyExpenses.reduce((sum, e) => sum + e.amount, 0);
      const netIncome = yearlyRevenue - expenseTotal;
      const roi = yearlyRevenue > 0 ? (netIncome / (yearlyRevenue * 10)) * 100 : 0;

      return {
        propertyId: property.id,
        propertyName: property.name,
        address: property.address,
        totalUnits: totalUnitsCount,
        occupiedUnits: occupiedUnitsCount,
        occupancyRate,
        monthlyRevenue,
        yearlyRevenue,
        expenses: expenseTotal,
        netIncome,
        roi,
      };
    });
  }, [properties, receipts, expenses]);

  // Maintenance stats (mock for now)
  const maintenanceStats: MaintenanceStats = {
    total: 12,
    pending: 3,
    inProgress: 2,
    completed: 7,
    urgent: 1,
    averageResolutionDays: 2.5,
  };

  // Recent activities
  const recentActivities = React.useMemo((): Activity[] => {
    const activities: Activity[] = [];

    // Add recent payments
    receipts
      .filter((r) => r.status === "paid")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
      .forEach((receipt) => {
        const tenant = tenants.find((t) => t.id === receipt.tenantId);
        activities.push({
          id: receipt.id,
          type: "payment",
          message: `Payment received from ${tenant?.name || receipt.propertyName || "Unknown"}`,
          timestamp: receipt.date,
          amount: receipt.amount,
          icon: "💰",
        });
      });

    return activities.slice(0, 5);
  }, [receipts, tenants]);

  // Chart data transformations
  const revenueChartData = revenueByMonth.map((m) => ({
    label: m.month,
    value: m.revenue,
  }));

  const _expenseChartData = revenueByMonth.map((m) => ({
    label: m.month,
    value: m.expenses,
    color: tokens.chartStatus.negative,
  }));

  const netIncomeChartData = revenueByMonth.map((m) => ({
    label: m.month,
    value: m.netIncome,
    color: m.netIncome >= 0 ? tokens.chartStatus.positive : tokens.chartStatus.negative,
  }));

  const propertyTypeData = properties.reduce<Record<string, number>>(
    (acc, property) => {
      const type = property.type || "other";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const propertyTypeChartData = Object.entries(propertyTypeData).map(([type, count]) => ({
    label: type.charAt(0).toUpperCase() + type.slice(1),
    value: count as number,
    color: getPropertyTypeColor(type),
  }));

  const handleRefresh = () => {
    setIsLoading(true);
    // Simulate refresh
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)] mb-1">
            <Home className="h-4 w-4" />
            <span>Situs</span>
            <span>/</span>
            <span className="text-[var(--color-foreground)]">{tNav("analytics")}</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--color-foreground)]">
            {t("heading")}
          </h2>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{t("subtitle")}</p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            {tActions("refresh")}
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            {t("export")}
          </Button>
          <Button variant="primary" size="sm">
            <FileText className="h-4 w-4 mr-2" />
            {t("generateReport")}
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <QuickStatsRow
        stats={[
          {
            label: t("collectionRate"),
            value: `${kpis.collectionRate.toFixed(0)}%`,
            icon: <Receipt className="h-4 w-4 text-green-400" />,
            color: "bg-green-500/10",
          },
          {
            label: tInsights("kpiAvgRent"),
            value: formatCurrency(kpis.averageRent),
            icon: <Wallet className="h-4 w-4 text-blue-400" />,
            color: "bg-blue-500/10",
          },
          {
            label: t("overdue"),
            value: kpis.overduePayments,
            icon: <Clock className="h-4 w-4 text-red-400" />,
            color: "bg-red-500/10",
          },
          {
            label: tInsights("kpiActiveTenants"),
            value: kpis.activeTenants,
            icon: <Users className="h-4 w-4 text-purple-400" />,
            color: "bg-purple-500/10",
          },
        ]}
      />

      {/* Tabs for different views */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview" className="gap-2">
            <PieChart className="h-4 w-4" />
            {t("tabOverview")}
          </TabsTrigger>
          <TabsTrigger value="financial" className="gap-2">
            <DollarSign className="h-4 w-4" />
            {t("tabFinancial")}
          </TabsTrigger>
          <TabsTrigger value="leases" className="gap-2">
            <Calendar className="h-4 w-4" />
            {t("tabLeases")}
          </TabsTrigger>
          <TabsTrigger value="properties" className="gap-2">
            <Building2 className="h-4 w-4" />
            {t("tabProperties")}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title={tDash("totalProperties")}
              value={kpis.totalProperties}
              change={5.2}
              changeLabel="vs last month"
              trend="up"
              icon={<Building2 className="h-5 w-5 text-blue-400" />}
            />
            <KPICard
              title={tDash("monthlyRevenue")}
              value={formatCurrency(kpis.monthlyRevenue)}
              change={8.3}
              changeLabel="vs last month"
              trend="up"
              variant="success"
              icon={<DollarSign className="h-5 w-5 text-green-400" />}
            />
            <KPICard
              title={t("netIncomeYtd")}
              value={formatCurrency(kpis.netIncome)}
              change={kpis.netIncome > 0 ? 12.5 : -5.2}
              changeLabel="vs last year"
              trend={kpis.netIncome > 0 ? "up" : "down"}
              variant={kpis.netIncome > 0 ? "success" : "danger"}
              icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
            />
            <KPICard
              title={t("overdueAmount")}
              value={formatCurrency(kpis.overdueAmount)}
              subtitle={`${kpis.overduePayments} payments`}
              variant={kpis.overduePayments > 0 ? "danger" : "default"}
              icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Occupancy Gauge */}
            <OccupancyGauge
              rate={kpis.occupancyRate}
              total={kpis.totalUnits}
              occupied={kpis.occupiedUnits}
              vacant={kpis.vacantUnits}
            />

            {/* Revenue Trend */}
            <div className="lg:col-span-2">
              <ChartWidget
                title={tCharts("revenueTrend")}
                subtitle={t("revenueLast6")}
                chart={<LineChart data={revenueChartData} height={200} showValues={false} />}
                onRefresh={handleRefresh}
              />
            </div>
          </div>

          {/* Second Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Lease Expirations */}
            <LeaseExpirationTimeline leases={leaseExpirations} />

            {/* Maintenance */}
            <MaintenanceStatusCard stats={maintenanceStats} />
          </div>

          {/* Activities and Portfolio */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ListWidget
                title={tDash("recentActivities")}
                subtitle={t("latestUpdates")}
                items={recentActivities}
                renderItem={(activity) => (
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{activity.icon}</span>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-[var(--color-muted-foreground)]">
                          {activity.message}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                          <span>{activity.type}</span>
                          {activity.amount && <span>• {formatCurrency(activity.amount)}</span>}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDate(activity.timestamp, locale)}
                    </span>
                  </div>
                )}
                emptyMessage={t("noActivities")}
              />
            </div>

            {/* Property Distribution */}
            <Card className="p-6">
              <CardHeader className="p-0 pb-4">
                <CardTitle className="text-lg font-semibold text-[var(--color-foreground)] flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-indigo-400" />
                  {t("portfolioMix")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {propertyTypeChartData.length > 0 ? (
                  <DonutChart data={propertyTypeChartData} height={180} />
                ) : (
                  <div className="flex items-center justify-center h-[180px] text-[var(--color-muted-foreground)]">
                    <p className="text-sm">{t("noPropertyData")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Financial Tab */}
        <TabsContent value="financial" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KPICard
              title={t("totalRevenueYtd")}
              value={formatCurrency(kpis.yearlyRevenue)}
              change={15.3}
              changeLabel="vs last year"
              trend="up"
              variant="success"
              icon={<DollarSign className="h-5 w-5 text-green-400" />}
            />
            <KPICard
              title={t("totalExpensesYtd")}
              value={formatCurrency(kpis.totalExpenses)}
              change={-3.2}
              changeLabel="vs last year"
              trend="down"
              icon={<ArrowDownRight className="h-5 w-5 text-red-400" />}
            />
            <KPICard
              title={t("netIncomeYtd")}
              value={formatCurrency(kpis.netIncome)}
              change={22.1}
              changeLabel="vs last year"
              trend="up"
              variant="success"
              icon={<ArrowUpRight className="h-5 w-5 text-emerald-400" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartWidget
              title={t("revenueVsExpenses")}
              subtitle={t("monthlyComparison")}
              chart={<BarChart data={revenueChartData} height={250} showTrend={false} />}
            />
            <ChartWidget
              title={t("netIncomeTrend")}
              subtitle={t("monthlyNetIncome")}
              chart={<AreaChart data={netIncomeChartData} height={250} />}
            />
          </div>
        </TabsContent>

        {/* Leases Tab */}
        <TabsContent value="leases" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KPICard
              title={t("activeLeases")}
              value={leases?.filter((l) => l.status === "active").length || 0}
              icon={<FileText className="h-5 w-5 text-blue-400" />}
            />
            <KPICard
              title={t("expiring30")}
              value={leaseExpirations.filter((l) => l.status === "critical").length}
              variant={
                leaseExpirations.filter((l) => l.status === "critical").length > 0
                  ? "warning"
                  : "default"
              }
              icon={<Clock className="h-5 w-5 text-orange-400" />}
            />
            <KPICard
              title={t("expiring60")}
              value={leaseExpirations.filter((l) => l.status === "warning").length}
              icon={<Calendar className="h-5 w-5 text-yellow-400" />}
            />
            <KPICard
              title={t("expired")}
              value={leaseExpirations.filter((l) => l.status === "expired").length}
              variant={
                leaseExpirations.filter((l) => l.status === "expired").length > 0
                  ? "danger"
                  : "default"
              }
              icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
            />
          </div>

          <LeaseCalendar events={transformToCalendarEvents(leaseExpirations)} />
        </TabsContent>

        {/* Properties Tab */}
        <TabsContent value="properties" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KPICard
              title={tDash("totalProperties")}
              value={kpis.totalProperties}
              icon={<Building2 className="h-5 w-5 text-blue-400" />}
            />
            <KPICard
              title={t("totalUnits")}
              value={kpis.totalUnits}
              icon={<Home className="h-5 w-5 text-cyan-400" />}
            />
            <KPICard
              title={t("occupied")}
              value={kpis.occupiedUnits}
              variant="success"
              icon={<Users className="h-5 w-5 text-green-400" />}
            />
            <KPICard
              title={t("vacant")}
              value={kpis.vacantUnits}
              variant={kpis.vacantUnits > 0 ? "warning" : "default"}
              icon={<Building2 className="h-5 w-5 text-yellow-400" />}
            />
          </div>

          <PropertyPerformanceTable data={propertyPerformance} formatCurrency={formatCurrency} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
