"use client";

import * as React from "react";
import { cn } from "@/lib/utils/utils";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Badge } from "./badge";
import { ProgressBar } from "./progress";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  Building2,
  Home,
  Wrench,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { getOccupancyColor } from "@/lib/design-tokens";

// KPI Card Component
interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

export function KPICard({
  title,
  value,
  subtitle,
  change,
  changeLabel,
  icon,
  trend,
  variant = "default",
  className,
}: KPICardProps) {
  const variantStyles = {
    default: "border-[var(--color-border)]",
    success: "border-[var(--color-success)]/30 bg-[var(--color-success-muted)]",
    warning: "border-[var(--color-warning)]/30 bg-[var(--color-warning-muted)]",
    danger: "border-[var(--color-destructive)]/30 bg-[var(--color-error-muted)]",
  };

  const trendIcon =
    trend === "up" ? (
      <TrendingUp className="h-4 w-4 text-[var(--color-success)]" />
    ) : trend === "down" ? (
      <TrendingDown className="h-4 w-4 text-[var(--color-destructive)]" />
    ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={cn(
          "relative overflow-hidden transition-all duration-300 hover:shadow-lg",
          variantStyles[variant],
          className,
        )}
      >
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--color-muted-foreground)]">{title}</p>
              <p className="text-3xl font-bold text-[var(--color-foreground)]">
                {typeof value === "number" ? value.toLocaleString() : value}
              </p>
              {subtitle && (
                <p className="text-xs text-[var(--color-muted-foreground)]">{subtitle}</p>
              )}
            </div>
            {icon && <div className="p-3 rounded-xl bg-[var(--color-surface)]">{icon}</div>}
          </div>

          {(change !== undefined || changeLabel) && (
            <div className="mt-4 flex items-center gap-2">
              {trendIcon}
              {change !== undefined && (
                <span
                  className={cn(
                    "text-sm font-medium",
                    change > 0
                      ? "text-[var(--color-success)]"
                      : change < 0
                        ? "text-[var(--color-destructive)]"
                        : "text-[var(--color-muted-foreground)]",
                  )}
                >
                  {change > 0 ? "+" : ""}
                  {change.toFixed(1)}%
                </span>
              )}
              {changeLabel && (
                <span className="text-xs text-[var(--color-muted-foreground)]">{changeLabel}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Occupancy Gauge Component
interface OccupancyGaugeProps {
  rate: number;
  total: number;
  occupied: number;
  vacant: number;
  className?: string;
}

export function OccupancyGauge({ rate, total, occupied, vacant, className }: OccupancyGaugeProps) {
  const t = useTranslations("analyticsWidgets");
  const tStatus = useTranslations("status");
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (rate / 100) * circumference;

  const getColor = (rate: number) => getOccupancyColor(rate);

  return (
    <Card className={cn("p-6", className)}>
      <CardHeader className="p-0 pb-4">
        <CardTitle className="text-lg font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[var(--color-info)]" />
          {t("occupancyRate")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex items-center justify-center">
          <div className="relative">
            <svg width="140" height="140" className="-rotate-90">
              {/* Background circle */}
              <circle
                cx="70"
                cy="70"
                r="45"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="10"
              />
              {/* Progress circle */}
              <motion.circle
                cx="70"
                cy="70"
                r="45"
                fill="none"
                stroke={getColor(rate)}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <span className="text-3xl font-bold text-[var(--color-foreground)]">
                  {rate.toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-[var(--color-foreground)]">{total}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("totalUnits")}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--color-success)]">{occupied}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{tStatus("occupied")}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--color-destructive)]">{vacant}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{tStatus("vacant")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Lease Expiration Timeline
interface LeaseExpirationItem {
  leaseId: string;
  tenantName: string;
  propertyName: string;
  unitNumber: string;
  endDate: string;
  daysUntilExpiration: number;
  monthlyRent: number;
  status: "expired" | "critical" | "warning" | "healthy";
}

interface LeaseExpirationTimelineProps {
  leases: LeaseExpirationItem[];
  className?: string;
  onViewAll?: () => void;
}

export function LeaseExpirationTimeline({
  leases,
  className,
  onViewAll,
}: LeaseExpirationTimelineProps) {
  const t = useTranslations("analyticsWidgets");
  const locale = useLocale();
  const getStatusConfig = (status: LeaseExpirationItem["status"]) => {
    switch (status) {
      case "expired":
        return {
          color: "bg-[var(--color-destructive)]",
          textColor: "text-[var(--color-destructive)]",
          icon: AlertTriangle,
        };
      case "critical":
        return {
          color: "bg-[var(--color-warning)]",
          textColor: "text-[var(--color-warning)]",
          icon: Clock,
        };
      case "warning":
        return {
          color: "bg-[var(--color-warning)]",
          textColor: "text-[var(--color-warning)]",
          icon: Calendar,
        };
      default:
        return {
          color: "bg-[var(--color-success)]",
          textColor: "text-[var(--color-success)]",
          icon: CheckCircle2,
        };
    }
  };

  return (
    <Card className={cn("p-6", className)}>
      <CardHeader className="p-0 pb-4 flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Calendar className="h-5 w-5 text-purple-400" />
          {t("upcomingExpirations")}
        </CardTitle>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-sm text-accent-primary hover:text-accent-primary/80 flex items-center gap-1"
          >
            {t("viewAll")} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </CardHeader>
      <CardContent className="p-0 space-y-3">
        {leases.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
            {t("noUpcomingExpirations")}
          </p>
        ) : (
          leases.slice(0, 5).map((lease, index) => {
            const config = getStatusConfig(lease.status);
            const StatusIcon = config.icon;

            return (
              <motion.div
                key={lease.leaseId}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center gap-4 p-3 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className={cn("w-2 h-12 rounded-full", config.color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-foreground)] truncate">
                    {lease.tenantName}
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)] truncate">
                    {lease.propertyName} - Unit {lease.unitNumber}
                  </p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <StatusIcon className={cn("h-4 w-4", config.textColor)} />
                    <span className={cn("text-sm font-medium", config.textColor)}>
                      {lease.daysUntilExpiration < 0
                        ? t("daysSince", { count: Math.abs(lease.daysUntilExpiration) })
                        : t("daysRemaining", { count: lease.daysUntilExpiration })}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {formatDate(lease.endDate, locale)}
                  </p>
                </div>
              </motion.div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// Maintenance Status Card
interface MaintenanceStatsProps {
  stats: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    urgent: number;
    averageResolutionDays: number;
  };
  className?: string;
}

export function MaintenanceStatusCard({ stats, className }: MaintenanceStatsProps) {
  const t = useTranslations("analyticsWidgets");
  const tMaint = useTranslations("maintenance");
  const completionRate = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;

  return (
    <Card className={cn("p-6", className)}>
      <CardHeader className="p-0 pb-4">
        <CardTitle className="text-lg font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Wrench className="h-5 w-5 text-[var(--color-warning)]" />
          {t("maintenanceOverview")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 rounded-lg bg-[var(--color-surface)]">
            <p className="text-2xl font-bold text-[var(--color-foreground)]">{stats.total}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{t("totalRequests")}</p>
          </div>
          {stats.urgent > 0 && (
            <div className="text-center p-3 rounded-lg bg-[var(--color-error-muted)] border border-[var(--color-destructive)]/30">
              <p className="text-2xl font-bold text-[var(--color-destructive)]">{stats.urgent}</p>
              <p className="text-xs text-[var(--color-destructive)]">{tMaint("urgent")}</p>
            </div>
          )}
          {stats.urgent === 0 && (
            <div className="text-center p-3 rounded-lg bg-[var(--color-surface)]">
              <p className="text-2xl font-bold text-[var(--color-foreground)]">
                {stats.averageResolutionDays.toFixed(1)}
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {t("avgDaysToResolve")}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-muted-foreground)]">{t("completionRate")}</span>
            <span className="text-[var(--color-foreground)] font-medium">
              {completionRate.toFixed(0)}%
            </span>
          </div>
          <ProgressBar progress={completionRate} height={8} className="" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <Badge
              variant="outline"
              className="text-[var(--color-warning)] border-[var(--color-warning)]/30"
            >
              {t("countPending", { count: stats.pending })}
            </Badge>
          </div>
          <div className="text-center">
            <Badge
              variant="outline"
              className="text-[var(--color-info)] border-[var(--color-info)]/30"
            >
              {t("countInProgress", { count: stats.inProgress })}
            </Badge>
          </div>
          <div className="text-center">
            <Badge
              variant="outline"
              className="text-[var(--color-success)] border-[var(--color-success)]/30"
            >
              {t("countDone", { count: stats.completed })}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Property Performance Table
interface PropertyPerformanceData {
  propertyId: string;
  propertyName: string;
  address: string;
  totalUnits: number;
  occupiedUnits: number;
  occupancyRate: number;
  monthlyRevenue: number;
  yearlyRevenue: number;
  expenses: number;
  netIncome: number;
  roi: number;
}

interface PropertyPerformanceTableProps {
  data: PropertyPerformanceData[];
  formatCurrency: (amount: number) => string;
  className?: string;
}

export function PropertyPerformanceTable({
  data,
  formatCurrency,
  className,
}: PropertyPerformanceTableProps) {
  const t = useTranslations("analyticsWidgets");
  return (
    <Card className={cn("p-6", className)}>
      <CardHeader className="p-0 pb-4">
        <CardTitle className="text-lg font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Home className="h-5 w-5 text-cyan-400" />
          {t("propertyPerformance")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">
            {t("noProperties")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th
                    scope="col"
                    className="text-left py-3 px-2 text-xs font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("colProperty")}
                  </th>
                  <th
                    scope="col"
                    className="text-center py-3 px-2 text-xs font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("colOccupancy")}
                  </th>
                  <th
                    scope="col"
                    className="text-right py-3 px-2 text-xs font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("colRevenue")}
                  </th>
                  <th
                    scope="col"
                    className="text-right py-3 px-2 text-xs font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("colNetIncome")}
                  </th>
                  <th
                    scope="col"
                    className="text-right py-3 px-2 text-xs font-medium text-[var(--color-muted-foreground)]"
                  >
                    {t("colRoi")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 5).map((property, index) => (
                  <motion.tr
                    key={property.propertyId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.1 }}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                  >
                    <td className="py-3 px-2">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">
                        {property.propertyName}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {property.totalUnits} units
                      </p>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <div className="inline-flex items-center gap-2">
                        <ProgressBar
                          progress={property.occupancyRate}
                          height={8}
                          className="w-16"
                        />
                        <span className="text-sm text-[var(--color-muted-foreground)]">
                          {property.occupancyRate.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <p className="text-sm text-[var(--color-foreground)]">
                        {formatCurrency(property.monthlyRevenue)}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">/month</p>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          property.netIncome >= 0
                            ? "text-[var(--color-success)]"
                            : "text-[var(--color-destructive)]",
                        )}
                      >
                        {formatCurrency(property.netIncome)}
                      </p>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <Badge
                        variant={
                          property.roi >= 8
                            ? "success"
                            : property.roi >= 5
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {property.roi.toFixed(1)}%
                      </Badge>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Quick Stats Row
interface QuickStatsProps {
  stats: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    color?: string;
  }[];
  className?: string;
}

export function QuickStatsRow({ stats, className }: QuickStatsProps) {
  return (
    <div className={cn("flex items-center gap-6 flex-wrap", className)}>
      {stats.map((stat, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className={cn("p-2 rounded-lg", stat.color || "bg-[var(--color-surface)]")}>
            {stat.icon}
          </div>
          <div>
            <p className="text-lg font-bold text-[var(--color-foreground)]">{stat.value}</p>
            <p className="text-xs text-[var(--color-muted-foreground)]">{stat.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
