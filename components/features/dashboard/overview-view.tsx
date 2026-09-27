"use client";

import { type ElementType, type ReactElement, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BadgeEuro,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  OnboardingChecklist,
  type OnboardingChecklistStep,
} from "@/components/ui/onboarding-checklist";
import {
  AttentionList,
  LoopStrip,
  MonthFigures,
  PortfolioLine,
  RecentActivity,
  RecentMoney,
  StatusLine,
} from "@/components/features/dashboard/month-glance";
import { useApp } from "@/lib/contexts/app-context";
import { useDashboardMonth } from "@/lib/hooks/use-dashboard-month";
import { useApiError } from "@/lib/utils/api-error";
import { formatMonthYear } from "@/lib/utils/format-date";

export interface OverviewViewProps {
  onAddProperty?: () => void;
  onAddTenant?: () => void;
  onAddLease?: () => void;
  onRecordPayment?: () => void;
}

interface MonthRef {
  year: number;
  month: number;
}

/** `?month=YYYY-MM`, or null for anything else. */
function parseMonth(value: string | null): MonthRef | null {
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

function currentMonth(): MonthRef {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shiftMonth({ year, month }: MonthRef, by: number): MonthRef {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The greeting for the hour on the owner's own clock. */
function greetingKey(hour: number): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  if (hour < 12) return "greetingMorning";
  if (hour < 20) return "greetingAfternoon";
  return "greetingEvening";
}

function FeatureHighlightCard({
  icon: Icon,
  title,
  description,
}: {
  icon: ElementType;
  title: string;
  description: string;
}) {
  return (
    <Card className="border border-[var(--color-border)] bg-[var(--color-card)]">
      <CardContent className="p-5">
        <div className="mb-3 inline-flex h-9 w-9 items-center justify-center bg-[var(--color-info-muted)]">
          <Icon className="h-4 w-4 text-[var(--color-primary)]" />
        </div>
        <h3 className="mb-1 text-sm font-semibold text-[var(--color-foreground)]">{title}</h3>
        <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">{description}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewView({
  onAddProperty,
  onAddTenant,
  onAddLease,
  onRecordPayment,
}: OverviewViewProps = {}): ReactElement {
  const { state } = useApp();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const apiError = useApiError();

  const { properties = [], tenants = [], leases = [], receipts = [], loading } = state;

  const [selected, setSelected] = useState<MonthRef>(
    () => parseMonth(searchParams.get("month")) ?? currentMonth(),
  );
  const { data: month, error } = useDashboardMonth(selected.year, selected.month);

  // Read on the owner's clock after mount, so the server's hour never decides the greeting.
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);

  const selectMonth = useCallback((next: MonthRef) => {
    setSelected(next);
    // Kept in the URL, so a reload or a shared link opens the same month.
    const params = new URLSearchParams(window.location.search);
    params.set("month", `${next.year}-${String(next.month).padStart(2, "0")}`);
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
  }, []);

  const navigate = (href: string) => router.push(href);
  const handleAddProperty = () =>
    onAddProperty?.() ?? navigate("/portfolio?action=create-property");
  const handleAddTenant = () =>
    onAddTenant?.() ?? navigate("/people?view=tenants&action=create-tenant");
  const handleAddLease = () => onAddLease?.() ?? navigate("/leases");
  const handleRecordPayment = () =>
    onRecordPayment?.() ?? navigate("/financials?tab=receipts&action=record-payment");

  const onboardingSteps: OnboardingChecklistStep[] = [
    {
      id: "property",
      label: t("addPropertyLabel"),
      description: t("addPropertyDesc"),
      completed: properties.length > 0,
      icon: Home,
      action: handleAddProperty,
      actionLabel: t("addPropertyAction"),
    },
    {
      id: "tenant",
      label: t("addTenantLabel"),
      description: t("addTenantDesc"),
      completed: tenants.length > 0,
      icon: UserRound,
      action: handleAddTenant,
      actionLabel: t("addTenantAction"),
    },
    {
      id: "lease",
      label: t("createLeaseLabel"),
      description: t("createLeaseDesc"),
      completed: leases.length > 0,
      icon: FileText,
      action: handleAddLease,
      actionLabel: t("createLeaseAction"),
    },
    {
      id: "payment",
      label: t("recordPaymentLabel"),
      description: t("recordPaymentDesc"),
      completed: receipts.length > 0,
      icon: BadgeEuro,
      action: handleRecordPayment,
      actionLabel: t("recordPaymentAction"),
    },
  ];
  const showChecklist = !onboardingSteps.every((step) => step.completed);

  if (loading) {
    return <div className="h-40 animate-pulse bg-[var(--color-muted)]/30" />;
  }

  if (properties.length === 0) {
    const richSteps = onboardingSteps.map((step) => ({
      ...step,
      completed: false,
      description: step.id === "property" ? t("addPropertyDesc2") : step.description,
    }));
    return (
      <div className="space-y-6">
        <OnboardingChecklist steps={richSteps} />
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureHighlightCard
            icon={Building2}
            title={t("featPropertiesTitle")}
            description={t("featPropertiesDesc")}
          />
          <FeatureHighlightCard
            icon={UserRound}
            title={t("featTenantsTitle")}
            description={t("featTenantsDesc")}
          />
          <FeatureHighlightCard
            icon={BadgeEuro}
            title={t("featFinancialsTitle")}
            description={t("featFinancialsDesc")}
          />
        </div>
      </div>
    );
  }

  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const greeting =
    hour === null
      ? null
      : firstName
        ? t("greetingNamed", { greeting: t(greetingKey(hour)), name: firstName })
        : t(greetingKey(hour));

  return (
    <div className="space-y-5 motion-safe:animate-fade-in">
      {showChecklist && <OnboardingChecklist steps={onboardingSteps} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-light text-[var(--color-foreground)]" data-testid="greeting">
          {greeting}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("previousMonth")}
            onClick={() => selectMonth(shiftMonth(selected, -1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <p
            className="min-w-36 text-center text-sm font-medium capitalize"
            aria-live="polite"
            data-testid="dashboard-month"
          >
            {formatMonthYear(selected.year, selected.month, locale)}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("nextMonth")}
            onClick={() => selectMonth(shiftMonth(selected, 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--semantic-danger-soft)] px-3 py-2 text-sm text-[var(--semantic-danger-readable)]"
        >
          {apiError(error)}
        </p>
      ) : null}

      {month ? (
        <>
          <StatusLine status={month.status} />
          <MonthFigures figures={month.figures} />
          <LoopStrip loop={month.loop} />
          <AttentionList attention={month.attention} />
          <RecentMoney recent={month.recent} />
          <PortfolioLine portfolio={month.portfolio} />
          <RecentActivity activity={month.activity} />
        </>
      ) : error ? null : (
        <div className="h-40 animate-pulse bg-[var(--color-muted)]/30" />
      )}
    </div>
  );
}
