"use client";

import { useMemo, useState, useEffect, type ReactElement } from "react";
import Link from "next/link";

import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileWarning,
  Flame,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import { useApp } from "@/lib/contexts/app-context";

type AlertSeverity = "critical" | "warning" | "info";

interface ActionAlert {
  id: string;
  icon: React.ElementType;
  message: string;
  count: number;
  href: string;
  severity: AlertSeverity;
}

/** Situs alert-card variant per severity (3px semantic left border + soft wash). */
const severityAlertClass: Record<AlertSeverity, string> = {
  critical: "alert-danger",
  warning: "alert-warning",
  info: "alert-info",
};

/** Semantic accent for the leading icon + count, matching the left border. */
const severityAccent: Record<AlertSeverity, string> = {
  critical: "text-[var(--semantic-danger)]",
  warning: "text-[var(--semantic-warning)]",
  info: "text-[var(--semantic-info)]",
};

function AlertRow({ alert }: { alert: ActionAlert }) {
  const Icon = alert.icon;
  return (
    <Link
      href={alert.href}
      className={cn(
        "alert-card transition-colors hover:brightness-[0.98]",
        severityAlertClass[alert.severity],
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon className={cn("h-4 w-4 shrink-0", severityAccent[alert.severity])} />
        {/* This is the home screen's primary attention line, and at 390px it was cut mid-word.
            `title` does not rescue it — a tooltip needs hover, which a phone has not got, so on
            touch the rest of the sentence was simply unavailable. Wrap to two lines below `md`
            where there is no room; keep the single truncated line once there is. */}
        <span
          className="text-sm font-medium text-[var(--color-foreground)] max-md:line-clamp-2 md:truncate"
          title={alert.message}
        >
          {alert.message}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className={cn(
            "font-mono text-xs font-semibold tabular-nums",
            severityAccent[alert.severity],
          )}
        >
          {alert.count}
        </span>
        <ChevronRight className="h-4 w-4 opacity-40" />
      </div>
    </Link>
  );
}

export function ActionPanel(): ReactElement {
  const { state } = useApp();
  const t = useTranslations("dashboard");

  const { leases = [], receipts = [], maintenance = [], properties = [] } = state;

  const [docExpiry, setDocExpiry] = useState<{ critical: number; warning: number } | null>(null);
  useEffect(() => {
    fetch("/api/documents/expiring")
      .then((r) => r.json())
      .then((d) => setDocExpiry(d.data ?? d))
      .catch(() => null);
  }, []);

  const [streakMonths, setStreakMonths] = useState(0);
  useEffect(() => {
    fetch("/api/activation")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStreakMonths(d?.data?.complianceStreak?.streakMonths ?? 0))
      .catch(() => null);
  }, []);

  const alerts = useMemo<ActionAlert[]>(() => {
    const now = new Date();
    const results: ActionAlert[] = [];

    // --- 1. Unpaid rent this month ---
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const activeLeases = leases.filter((l) => l.status === "active");

    const leasesWithoutReceiptThisMonth = activeLeases.filter((lease) => {
      const hasPaidReceipt = receipts.some((r) => {
        const d = new Date(r.date);
        return (
          r.leaseId === lease.id &&
          r.type === "rent" &&
          r.status === "paid" &&
          d >= monthStart &&
          d <= monthEnd
        );
      });
      return !hasPaidReceipt;
    });

    if (leasesWithoutReceiptThisMonth.length > 0) {
      results.push({
        id: "unpaid-rent",
        icon: Clock,
        message: t("rentDueAlert", {
          count: leasesWithoutReceiptThisMonth.length,
          total: activeLeases.length,
        }),
        count: leasesWithoutReceiptThisMonth.length,
        href: "/financials",
        severity: "warning",
      });
    }

    // --- 2. Overdue payments (pending receipts older than 5 days) ---
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const overdueReceipts = receipts.filter((r) => {
      const d = new Date(r.date);
      return r.status === "pending" && d < fiveDaysAgo;
    });

    if (overdueReceipts.length > 0) {
      results.push({
        id: "overdue-payments",
        icon: AlertTriangle,
        message: t("overdueAlert", { count: overdueReceipts.length }),
        count: overdueReceipts.length,
        href: "/financials",
        severity: "critical",
      });
    }

    // --- 3. Maintenance open > 7 days ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const staleMaintenance = maintenance.filter((ticket) => {
      return (
        (ticket.status === "open" || ticket.status === "in_progress") &&
        new Date(ticket.createdAt) < sevenDaysAgo
      );
    });

    if (staleMaintenance.length > 0) {
      // Find oldest for the message
      const oldest = [...staleMaintenance].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];
      const daysOpen = Math.floor(
        (now.getTime() - new Date(oldest.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      results.push({
        id: "stale-maintenance",
        icon: Wrench,
        message: t("maintenanceOpenAlert", { count: staleMaintenance.length, days: daysOpen }),
        count: staleMaintenance.length,
        href: "/operations",
        severity: "critical",
      });
    }

    // --- 4. Leases expiring within 30 days (renewal-aware) ---
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const soonExpiring = activeLeases.filter((l) => {
      const end = new Date(l.endDate);
      return end > now && end <= thirtyDaysFromNow;
    });

    // Split by renewal status for contextual messaging
    const noOfferExpiring = soonExpiring.filter(
      (l) => !l.renewalStatus || l.renewalStatus === "declined",
    );
    const awaitingResponse = soonExpiring.filter((l) => l.renewalStatus === "offered");
    const renewalAccepted = soonExpiring.filter((l) => l.renewalStatus === "accepted");

    if (noOfferExpiring.length > 0) {
      const soonest = [...noOfferExpiring].sort(
        (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime(),
      )[0];
      const daysLeft = Math.ceil(
        (new Date(soonest.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const propName =
        properties.find((p) => p.id === soonest.propertyId)?.name ?? soonest.property?.name ?? "—";
      results.push({
        id: "expiring-30d-no-offer",
        icon: CalendarClock,
        message: t("leaseExpiringNoRenewal", { property: propName, days: daysLeft }),
        count: noOfferExpiring.length,
        href: "/leases",
        severity: "critical",
      });
    }

    if (awaitingResponse.length > 0) {
      results.push({
        id: "expiring-30d-awaiting",
        icon: CalendarClock,
        message: t("leaseExpiringAwaiting", { count: awaitingResponse.length }),
        count: awaitingResponse.length,
        href: "/leases",
        severity: "warning",
      });
    }

    if (renewalAccepted.length > 0) {
      results.push({
        id: "expiring-30d-accepted",
        icon: CalendarClock,
        message: t("leaseExpiringAccepted", { count: renewalAccepted.length }),
        count: renewalAccepted.length,
        href: "/leases",
        severity: "info",
      });
    }

    // --- 5. Leases expiring within 90 days (secondary warning, no renewal offered) ---
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const soonExpiring90 = activeLeases.filter((l) => {
      const end = new Date(l.endDate);
      return (
        end > thirtyDaysFromNow &&
        end <= ninetyDaysFromNow &&
        (!l.renewalStatus || l.renewalStatus === "declined")
      );
    });

    if (soonExpiring90.length > 0) {
      results.push({
        id: "expiring-90d",
        icon: CalendarClock,
        message: t("leaseExpiring90Alert", { count: soonExpiring90.length }),
        count: soonExpiring90.length,
        href: "/leases",
        severity: "warning",
      });
    }

    // --- 6. Document expiry ---
    if (docExpiry?.critical) {
      results.push({
        id: "doc-expiry-critical",
        icon: FileWarning,
        message: t("docExpiryCritical", { count: docExpiry.critical }),
        count: docExpiry.critical,
        href: "/documents",
        severity: "critical",
      });
    }
    if (docExpiry?.warning) {
      results.push({
        id: "doc-expiry-warning",
        icon: FileWarning,
        message: t("docExpiryWarning", { count: docExpiry.warning }),
        count: docExpiry.warning,
        href: "/documents",
        severity: "warning",
      });
    }

    return results;
  }, [leases, receipts, maintenance, properties, t, docExpiry]);

  return (
    <Card className="border-[var(--color-border)] bg-[var(--color-card)]">
      {/* Title only. The subtitle read "O que precisa da sua atenção agora." under a heading that
          already says "Tarefas de hoje" — it restated the title rather than adding to it, and it
          did so above a list that is often one row, so the panel spent as much height explaining
          itself as showing anything. The strings stay in the catalogues; nothing else uses this
          one, and deleting four translations to save a line is a worse trade than leaving them. */}
      <CardHeader className="pb-3">
        <CardTitle>{t("actionPanelTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.length === 0 ? (
          <div className="alert-card alert-success">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--semantic-success)]" />
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {t("allClear")}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{t("allClearDesc")}</p>
              </div>
            </div>
            {streakMonths > 0 && (
              <div className="flex shrink-0 items-center gap-1.5 border border-[var(--semantic-warning)]/30 bg-[var(--semantic-warning-soft)] px-2.5 py-1 text-xs font-medium text-[var(--semantic-warning)]">
                <Flame className="h-3.5 w-3.5" />
                {t("streakMonths", { count: streakMonths })}
              </div>
            )}
          </div>
        ) : (
          alerts.map((alert) => <AlertRow key={alert.id} alert={alert} />)
        )}
      </CardContent>
    </Card>
  );
}
