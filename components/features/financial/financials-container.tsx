"use client";

import { PageHeader } from "@/components/shared/page-header";
import { useEffect, useEffectEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsMobileSelect, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/ui/export-button";
import { useTabPersistence } from "@/lib/hooks/use-tab-persistence";
import { useBankInboxSummary } from "@/lib/hooks/use-bank-inbox-summary";
import { useApp } from "@/lib/contexts/app-context";
import { ReceiptsView } from "./receipts-view";
import { ExpensesView } from "./expenses-view";
import { YearlyRentMatrix } from "./yearly-rent-matrix";
import { BankMovementsInbox } from "./bank-movements-inbox";
import { TaxConnectorDashboard } from "./tax-connector-dashboard";
import { FinancialsView } from "./financials-view";
import { OwnerSharesView } from "./owner-shares-view";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { BarChart3, Grid3X3, Landmark, PieChart, Plus, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const PAYMENT_TABS = ["ledger", "movements", "expenses", "shares", "reports"] as const;
type PaymentTab = (typeof PAYMENT_TABS)[number];

/**
 * The tabs Finance had before it was regrouped, and where each went, so a bookmark, a stored tab
 * or a link written before still lands: Receipts and Tax summary are both in Reports.
 */
const FORMER_TABS: Record<string, PaymentTab> = {
  "rent-matrix": "ledger",
  bank: "movements",
  receipts: "reports",
  tax: "reports",
  overview: "reports",
};

/** The tab a stored or linked value names, old names included; null for anything else. */
function paymentTab(value: string | null): PaymentTab | null {
  if (value === null) return null;
  if ((PAYMENT_TABS as readonly string[]).includes(value)) return value as PaymentTab;
  return FORMER_TABS[value] ?? null;
}

export function FinancialsContainer() {
  const t = useTranslations("payments");
  const tNav = useTranslations("navigation");
  const [activeTab, setActiveTab] = useTabPersistence("payments", "ledger");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tenantId = searchParams.get("tenantId") ?? undefined;
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const tabParam = searchParams.get("tab");
  const recordPaymentLink = searchParams.get("action") === "record-payment";
  const { state } = useApp();
  // Held here rather than in the inbox: Radix unmounts an inactive tab, and the Bank tab's count
  // has to show while another tab is open.
  const { summary: bankSummary, refresh: refreshBankSummary } = useBankInboxSummary();
  // Registar pagamento opens where the owner is. The form used to live in the Receipts tab, so
  // the header button switched tabs first, and a link carrying `?action=record-payment` did too.
  const [recordingPayment, setRecordingPayment] = useState(() => recordPaymentLink);
  // Bumped when a payment is recorded here, so the rent matrix reads the ledger again.
  const [ledgerVersion, setLedgerVersion] = useState(0);

  // Links into Finance carry two one-shot parameters: `?tab=` picks a tab, and
  // `?action=record-payment` opens the payment form. A link is followed once, when it arrives,
  // and both parameters are then dropped from the address, the tab moving to `?view=`, which the
  // tab hook keeps. The effect runs only when a link's parameters change, never when the tab
  // does: applied after every tab change, `?tab=` pulled the page back to its tab each time the
  // owner picked another one.
  const followLink = useEffectEvent(() => {
    const target = paymentTab(tabParam);
    // A `view` beside the `tab` means the owner picked a tab before the address caught up.
    const apply = target !== null && searchParams.get("view") === null;
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
      : // Unscoped, the heading and the tabs already say what the page is; the line under the
        // title is kept for the one case that adds something, a tenant or property filter.
        undefined;

  /** Tab set as data, so the bar and its mobile select can never drift apart. */
  const paymentTabs: {
    value: PaymentTab;
    label: string;
    icon: LucideIcon;
    /** A count of work waiting there, shown only when there is some. */
    badge?: number;
  }[] = [
    { value: "ledger", label: t("tabs.ledger"), icon: Grid3X3 },
    {
      value: "movements",
      label: t("tabs.movements"),
      icon: Landmark,
      badge: bankSummary?.toReview || undefined,
    },
    { value: "expenses", label: t("tabs.expenses"), icon: Wallet },
    // What each co-owner is due from the rent collected for the properties they share.
    { value: "shares", label: t("tabs.shares"), icon: PieChart },
    { value: "reports", label: t("tabs.reports"), icon: BarChart3 },
  ];
  // A tab stored under an old name is read as the tab it became; one that names nothing would
  // otherwise select no panel and leave the page blank.
  const visibleTab: PaymentTab = paymentTab(activeTab) ?? "ledger";

  return (
    <div className="space-y-6">
      {/* The heading is the menu label, so the page you land on is named as the link you
          tapped (it read "Pagamentos" under "Finanças", "Gestão de Contratos" under "Contratos"). */}
      <PageHeader title={tNav("finance")} description={ownerDescription}>
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
      </PageHeader>

      {/* No figure tiles here. Overdue rent, receipts to issue and the month's takings are on Home,
          and the ledger below says who owes what. */}
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
          <TabsList className="flex w-full max-w-full justify-start overflow-x-auto max-md:hidden">
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

        <TabsContent value="ledger" className="mt-0">
          <YearlyRentMatrix ledgerVersion={ledgerVersion} />
        </TabsContent>

        <TabsContent value="movements" className="mt-0">
          <BankMovementsInbox summary={bankSummary} onChanged={refreshBankSummary} />
        </TabsContent>

        <TabsContent value="expenses" className="mt-0">
          <ExpensesView />
        </TabsContent>

        <TabsContent value="shares" className="mt-0">
          <OwnerSharesView />
        </TabsContent>

        {/* What has happened, to read and to file: the period's figures, the receipts register
            month by month, and what reached Finanças. Issuing a receipt is Home's work now. */}
        <TabsContent value="reports" className="mt-0 space-y-6">
          <FinancialsView />
          <ReceiptsView tenantId={tenantId} propertyId={propertyId} />
          <TaxConnectorDashboard />
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
