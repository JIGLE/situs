"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsMobileSelect, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/ui/export-button";
import { useTabPersistence } from "@/lib/hooks/use-tab-persistence";
import { useBankInboxSummary } from "@/lib/hooks/use-bank-inbox-summary";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { getActiveLease } from "@/lib/utils/lease-helpers";
import { isIssuable } from "@/lib/utils/receipt-months";
import { cn } from "@/lib/utils/utils";
import { ReceiptsView } from "./receipts-view";
import { YearlyRentMatrix } from "./yearly-rent-matrix";
import { BankMovementsInbox } from "./bank-movements-inbox";
import { TaxConnectorDashboard } from "./tax-connector-dashboard";
import { FinancialsView } from "./financials-view";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { FileText, Grid3X3, Landmark, Plus, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PAYMENT_TABS = ["receipts", "rent-matrix", "bank", "tax"] as const;
type PaymentTab = (typeof PAYMENT_TABS)[number];

function isPaymentTab(value: string | null): value is PaymentTab {
  return (PAYMENT_TABS as readonly (string | null)[]).includes(value);
}

export function FinancialsContainer() {
  const t = useTranslations("payments");
  const [activeTab, setActiveTab] = useTabPersistence("payments", "rent-matrix");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tenantId = searchParams.get("tenantId") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const tabParam = searchParams.get("tab");
  const recordPaymentLink = searchParams.get("action") === "record-payment";
  const { state } = useApp();
  const { formatCurrency } = useCurrency();
  // Held here rather than in the inbox: Radix unmounts an inactive tab, and the Bank tab's count
  // has to show while another tab is open.
  const { summary: bankSummary, refresh: refreshBankSummary } = useBankInboxSummary();
  // Registar pagamento opens where the owner is. The form used to live in the Receipts tab, so
  // the header button switched tabs first, and a link carrying `?action=record-payment` did too.
  const [recordingPayment, setRecordingPayment] = useState(() => recordPaymentLink);
  // Bumped when a payment is recorded here, so the rent matrix reads the ledger again.
  const [ledgerVersion, setLedgerVersion] = useState(0);
  // Receipts still to issue, in any month: the Receipts tab's count of work waiting.
  const toIssue = useMemo(
    () => state.receipts.filter((receipt) => isIssuable(receipt.lifecycle)).length,
    [state.receipts],
  );

  // Links into Finance carry two one-shot parameters: `?tab=` picks a tab, and
  // `?action=record-payment` opens the payment form. A link is followed once, when it arrives,
  // and both parameters are then dropped from the address, the tab moving to `?view=`, which the
  // tab hook keeps. The effect runs only when a link's parameters change, never when the tab
  // does: applied after every tab change, `?tab=` pulled the page back to its tab each time the
  // owner picked another one.
  const followLink = useEffectEvent(() => {
    const target = tabParam === "overview" ? "tax" : tabParam;
    // A `view` beside the `tab` means the owner picked a tab before the address caught up.
    const apply = isPaymentTab(target) && searchParams.get("view") === null;
    if (apply) setActiveTab(target);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    if (recordPaymentLink) params.delete("action");
    if (apply) params.set("view", target);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  });
  useEffect(() => {
    if (tabParam !== null || recordPaymentLink) followLink();
  }, [tabParam, recordPaymentLink]);

  const metrics = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const monthlyCollected = state.receipts
      .filter((receipt) => {
        const receiptDate = new Date(receipt.date);
        return (
          receipt.status === "paid" &&
          receipt.type === "rent" &&
          receiptDate >= monthStart &&
          receiptDate <= monthEnd
        );
      })
      .reduce((sum, receipt) => sum + receipt.amount, 0);

    const overdueAmount = state.tenants
      .filter((tenant) => tenant.paymentStatus === "overdue")
      .reduce((sum, tenant) => {
        const activeLease = getActiveLease(tenant.id, state.leases);
        return sum + (activeLease?.monthlyRent ?? tenant.rent ?? 0);
      }, 0);

    const pendingReceipts = state.receipts.filter((receipt) => receipt.status === "pending").length;

    return {
      monthlyCollected,
      overdueAmount,
      pendingReceipts,
    };
  }, [state.leases, state.receipts, state.tenants]);

  const selectedTenant = tenantId
    ? state.tenants.find((tenant) => tenant.id === tenantId)
    : undefined;
  const selectedProperty = propertyId
    ? state.properties.find((property) => property.id === propertyId)
    : undefined;
  const ownerDescription = tenantId
    ? t("descTenantScope", { name: selectedTenant?.name ?? t("theSelectedTenant") })
    : propertyId
      ? t("descPropertyScope", { name: selectedProperty?.name ?? t("theSelectedProperty") })
      : t("desc");

  /** Tab set as data, so the bar and its mobile select can never drift apart. */
  const paymentTabs: {
    value: PaymentTab;
    label: string;
    icon: LucideIcon;
    /** A count of work waiting there, shown only when there is some. */
    badge?: number;
  }[] = [
    { value: "receipts", label: t("tabs.receipts"), icon: Receipt, badge: toIssue || undefined },
    { value: "rent-matrix", label: t("tabs.rentMatrix"), icon: Grid3X3 },
    {
      value: "bank",
      label: t("tabs.bank"),
      icon: Landmark,
      badge: bankSummary?.toReview || undefined,
    },
    { value: "tax", label: t("tabs.tax"), icon: FileText },
  ];
  // A tab stored before it was removed (localStorage, a `?view=` bookmark) would otherwise
  // select no panel and leave the page blank below the stat cards.
  const visibleTab: PaymentTab = isPaymentTab(activeTab) ? activeTab : "rent-matrix";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">{ownerDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            data={state.receipts}
            filename="payments-export"
            columns={[
              { key: "tenantName", label: t("colTenant") },
              { key: "propertyName", label: t("colProperty") },
              { key: "amount", label: t("colAmount") },
              { key: "date", label: t("colDate") },
              { key: "status", label: t("colStatus") },
            ]}
          />
          <Button onClick={() => setRecordingPayment(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("recordPayment")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => setActiveTab("rent-matrix")}
          className={cn(
            "panel p-4 text-left transition-colors hover:border-[var(--color-border-hover)]",
            metrics.overdueAmount > 0 &&
              "border-l-[3px] border-l-[var(--semantic-danger)] bg-[var(--semantic-danger-soft)]",
          )}
        >
          <p className="mono-label">{t("overdueRent")}</p>
          <p
            className={cn(
              "mt-2 text-xl font-light tabular-nums sm:text-2xl",
              metrics.overdueAmount > 0
                ? "text-[var(--semantic-danger)]"
                : "text-[var(--color-foreground)]",
            )}
          >
            {formatCurrency(metrics.overdueAmount)}
          </p>
          <p className="mt-2 text-[13px] leading-snug text-[var(--color-muted-foreground)]">
            {t("overdueRentHint")}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("receipts")}
          className={cn(
            "panel p-4 text-left transition-colors hover:border-[var(--color-border-hover)]",
            metrics.pendingReceipts > 0 &&
              "border-l-[3px] border-l-[var(--country-highlight-readable)] bg-[var(--country-highlight-soft)]",
          )}
        >
          <p className="mono-label">{t("pendingReceipts")}</p>
          <p className="mt-2 text-xl font-light tabular-nums text-[var(--color-foreground)] sm:text-2xl">
            {metrics.pendingReceipts}
          </p>
          <p className="mt-2 text-[13px] leading-snug text-[var(--color-muted-foreground)]">
            {t("pendingReceiptsHint")}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("receipts")}
          className="panel p-4 text-left transition-colors hover:border-[var(--color-border-hover)]"
        >
          <p className="mono-label">{t("collectedMonth")}</p>
          <p className="mt-2 text-xl font-light tabular-nums text-[var(--semantic-success)] sm:text-2xl">
            {formatCurrency(metrics.monthlyCollected)}
          </p>
          <p className="mt-2 text-[13px] leading-snug text-[var(--color-muted-foreground)]">
            {t("collectedMonthHint")}
          </p>
        </button>
      </div>

      <Tabs
        value={visibleTab}
        onValueChange={(value) => setActiveTab(value as PaymentTab)}
        className="space-y-6"
      >
        {/* One source for both renderings. Responsive rule 4 is a space test, and this bar fails
            it: at 390px its triggers overflow their container, so the last ones were reachable
            only by discovering a horizontal scroll. Below `md` it gives way to a select. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsMobileSelect
            className="md:hidden"
            value={visibleTab}
            onValueChange={(value) => setActiveTab(value as PaymentTab)}
            items={paymentTabs.map(({ value, label, badge }) => ({ value, label, badge }))}
            aria-label={t("title")}
          />
          <TabsList className="flex w-full max-w-full justify-start gap-1 overflow-x-auto max-md:hidden">
            {paymentTabs.map(({ value, label, icon: Icon, badge }) => (
              <TabsTrigger key={value} value={value} className="flex shrink-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
                {badge ? (
                  <span className="ml-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs tabular-nums">
                    {badge}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="receipts" className="mt-0">
          <ReceiptsView tenantId={tenantId} propertyId={propertyId} />
        </TabsContent>

        <TabsContent value="rent-matrix" className="mt-0">
          <YearlyRentMatrix ledgerVersion={ledgerVersion} />
        </TabsContent>

        <TabsContent value="bank" className="mt-0">
          <BankMovementsInbox summary={bankSummary} onChanged={refreshBankSummary} />
        </TabsContent>

        <TabsContent value="tax" className="mt-0 space-y-4">
          <TaxConnectorDashboard />
          <FinancialsView />
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog
        open={recordingPayment}
        onOpenChange={setRecordingPayment}
        preset={{ tenantId, propertyId }}
        onRecorded={() => setLedgerVersion((v) => v + 1)}
      />
    </div>
  );
}
