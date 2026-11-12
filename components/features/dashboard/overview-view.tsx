"use client";

import { PageHeader } from "@/components/shared/page-header";
import { type ElementType, type ReactElement, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { BadgeEuro, Building2, FileText, Home, Landmark, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  OnboardingChecklist,
  type OnboardingChecklistStep,
} from "@/components/ui/onboarding-checklist";
import {
  AttentionList,
  LateList,
  MonthBlock,
  StatusLine,
  UpcomingList,
  YearLine,
} from "@/components/features/dashboard/month-glance";
import { HomeInbox } from "@/components/features/dashboard/home-inbox";
import { useApp } from "@/lib/contexts/app-context";
import { useDashboardMonth } from "@/lib/hooks/use-dashboard-month";
import { useApiError } from "@/lib/utils/api-error";

export interface OverviewViewProps {
  onAddProperty?: () => void;
  onAddLease?: () => void;
  onConnectBank?: () => void;
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
  onAddLease,
  onConnectBank,
}: OverviewViewProps = {}): ReactElement {
  const { state } = useApp();
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("dashboard");
  const apiError = useApiError();

  const { properties = [], leases = [], receipts = [], loading } = state;

  const [selected, setSelected] = useState<MonthRef>(
    () => parseMonth(searchParams.get("month")) ?? currentMonth(),
  );
  const { data: month, error, reload } = useDashboardMonth(selected.year, selected.month);

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
  const handleAddLease = () => onAddLease?.() ?? navigate("/portfolio?tab=leases&action=create");
  const handleConnectBank = () => onConnectBank?.() ?? navigate("/settings?tab=integrations");

  // Add a property, start a tenancy, connect the bank. Recording a payment by hand was a step;
  // the bank brings payments in, so it now only completes the bank's step where there is none.
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
      id: "tenancy",
      label: t("startTenancyLabel"),
      description: t("startTenancyDesc"),
      completed: leases.length > 0,
      icon: FileText,
      action: handleAddLease,
      actionLabel: t("startTenancyAction"),
    },
    {
      id: "bank",
      label: t("connectBankLabel"),
      description: t("connectBankDesc"),
      completed: Boolean(month?.status.bank) || receipts.length > 0,
      icon: Landmark,
      action: handleConnectBank,
      actionLabel: t("connectBankAction"),
    },
  ];
  const showChecklist = !onboardingSteps.every((step) => step.completed);

  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const greeting =
    hour === null
      ? null
      : firstName
        ? t("greetingNamed", { greeting: t(greetingKey(hour)), name: firstName })
        : t(greetingKey(hour));

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
        <PageHeader title={greeting ?? ""} titleOnMobile titleTestId="greeting" />
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

  return (
    <div className="space-y-5 motion-safe:animate-fade-in">
      {showChecklist && <OnboardingChecklist steps={onboardingSteps} />}

      {/* On a phone the top bar already says Início, so the greeting is the desktop's heading
          only: one heading per screen. */}
      <div className="space-y-1">
        <PageHeader title={greeting ?? ""} titleTestId="greeting" />
        {month ? (
          <div className="space-y-0.5">
            <YearLine year={month.year} totals={month.yearTotals} />
            <StatusLine status={month.status} />
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-[var(--semantic-danger-soft)] px-3 py-2 text-sm text-[var(--semantic-danger-readable)]"
        >
          {apiError(error)}
        </p>
      ) : null}

      {month ? (
        // Two columns on a wide screen: this month and what waits on the left, who is late and
        // what comes next on the right. One column, in that order, on a phone.
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 space-y-5">
            {/* The label follows the choice at once; the rows follow when the month arrives. */}
            <MonthBlock
              year={selected.year}
              month={selected.month}
              figures={month.figures}
              tenancies={month.tenancies}
              onPrevious={() => selectMonth(shiftMonth(selected, -1))}
              onNext={() => selectMonth(shiftMonth(selected, 1))}
            />
            <HomeInbox onChanged={reload} />
          </div>
          <div className="min-w-0 space-y-5">
            <LateList late={month.late} />
            <UpcomingList upcoming={month.upcoming} />
            <AttentionList attention={month.attention} />
          </div>
        </div>
      ) : error ? null : (
        <div className="h-40 animate-pulse bg-[var(--color-muted)]/30" />
      )}
    </div>
  );
}
