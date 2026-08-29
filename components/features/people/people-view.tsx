"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Users, Briefcase, Plus, Wrench, MessageSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsMobileSelect, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useTabPersistence } from "@/lib/hooks/use-tab-persistence";
import { TenantsView, TenantsViewRef } from "@/components/features/tenant/tenants-view";
import { OwnersView, OwnersViewRef } from "@/components/features/owner/owners-view";
import { ContactsView } from "@/components/features/contacts/contacts-view";
import { CorrespondenceView } from "@/components/features/correspondence/correspondence-view";
import { ExportButton } from "@/components/ui/export-button";
import { useApp } from "@/lib/contexts/app-context";

/**
 * People View - Unified view for managing all people: tenants and owners
 *
 * Information Architecture:
 * - Purpose: Manage tenant and owner relationships
 * - Belongs here: Tenant directory, Owner directory, service providers, communication history
 * - Communications tab embeds CorrespondenceView (templates + message log); the standalone
 *   /correspondence route stays live for deep links but is not a nav rail item
 * - Forbidden: Property CRUD, maintenance details, expense tracking
 * - Links to: Assets (tenant's/owner's property), Maintenance (tickets)
 */
export function PeopleView(): React.ReactElement {
  const [activeTab, setActiveTab] = useTabPersistence("people", "tenants");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { state } = useApp();
  const { tenants, owners } = state;
  const tenantsViewRef = useRef<TenantsViewRef>(null);
  const ownersViewRef = useRef<OwnersViewRef>(null);
  const t = useTranslations("people");

  useEffect(() => {
    const view = searchParams.get("view");
    if (
      (view === "owners" ||
        view === "contacts" ||
        view === "tenants" ||
        view === "communications") &&
      view !== activeTab
    ) {
      setActiveTab(view);
    }
  }, [activeTab, searchParams, setActiveTab]);

  // Onboarding checklist deep-links here with ?view=tenants&action=create-tenant
  // (`overview-view.tsx`'s handleAddTenant) expecting the create dialog to open
  // automatically. `TenantsView` only mounts while its tab is active, so wait until
  // the tab switch above (if any) lands on "tenants" before opening.
  const [pendingCreateTenant, setPendingCreateTenant] = useState(
    () => searchParams.get("action") === "create-tenant",
  );
  useEffect(() => {
    if (pendingCreateTenant && activeTab === "tenants") {
      tenantsViewRef.current?.openDialog();
      setPendingCreateTenant(false);
      router.replace(pathname);
    }
  }, [pendingCreateTenant, activeTab, router, pathname]);

  // Export columns for tenants
  const tenantColumns = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "paymentStatus", label: "Status" },
    { key: "leaseStart", label: "Lease Start" },
    { key: "leaseEnd", label: "Lease End" },
  ];

  // Export columns for owners
  const ownerColumns = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
  ];

  // Get export data based on active tab
  const exportConfig =
    activeTab === "tenants"
      ? { data: tenants, columns: tenantColumns }
      : { data: owners, columns: ownerColumns };

  return (
    <div className="space-y-6">
      {/* Page header. Tenant/owner totals live on the tab count badges below,
          so no separate stat row is needed. Export only applies to the
          tenant/owner directories — the Contacts/Communications tabs manage
          their own data, so it stays hidden there rather than exporting the
          wrong records under a "{tab}-export" filename. */}
      <div className="flex flex-row items-center justify-between gap-4">
        {/* The bottom nav already labels this screen — hide the repeated
            title/subtitle on mobile so content starts higher. */}
        <div className="hidden sm:block">
          <h1 className="text-3xl font-bold text-[var(--color-foreground)] flex items-center gap-2">
            <Users className="h-8 w-8" />
            {t("title")}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{t("subtitle")}</p>
        </div>
        {(activeTab === "tenants" || activeTab === "owners") && (
          <div className="ml-auto flex items-center gap-2">
            <ExportButton
              data={exportConfig.data}
              filename={`${activeTab}-export`}
              columns={exportConfig.columns}
            />
          </div>
        )}
      </div>

      {/* Tab Navigation - Tenants and Owners */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="flex items-center gap-2">
          {/* The select takes the bar's place below `md`, in the same row, so the adjacent
              create button stays on the line it has always been on. */}
          <TabsMobileSelect
            className="min-w-0 flex-1 md:hidden"
            value={activeTab}
            onValueChange={setActiveTab}
            /* Names the switcher, not one of its options. Every other TabsMobileSelect
               call site labels the screen; this one said "Tenants", so a screen reader
               announced the People section switcher as the tenants control. */
            aria-label={t("title")}
            items={[
              { value: "tenants", label: t("tenants"), badge: tenants.length },
              { value: "owners", label: t("owners"), badge: owners.length },
              { value: "contacts", label: t("serviceProviders") },
              { value: "communications", label: t("communications") },
            ]}
          />
          <TabsList className="flex w-full max-w-2xl justify-start overflow-x-auto max-md:hidden sm:grid sm:grid-cols-4">
            <TabsTrigger value="tenants" className="flex shrink-0 items-center gap-2">
              <Users className="h-4 w-4 shrink-0" />
              <span>{t("tenants")}</span>
              <span className="ml-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs tabular-nums">
                {tenants.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="owners" className="flex shrink-0 items-center gap-2">
              <Briefcase className="h-4 w-4 shrink-0" />
              <span>{t("owners")}</span>
              <span className="ml-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs tabular-nums">
                {owners.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="contacts"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap"
            >
              <Wrench className="h-4 w-4 shrink-0" />
              <span>{t("serviceProviders")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="communications"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap"
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span>{t("communications")}</span>
            </TabsTrigger>
          </TabsList>
          {activeTab === "tenants" && (
            <Button
              onClick={() => tenantsViewRef.current?.openDialog()}
              className="flex shrink-0 items-center gap-2"
              aria-label={t("addTenant")}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("addTenant")}</span>
            </Button>
          )}
          {activeTab === "owners" && (
            <Button
              onClick={() => ownersViewRef.current?.openDialog()}
              className="flex shrink-0 items-center gap-2"
              aria-label={t("addOwner")}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("addOwner")}</span>
            </Button>
          )}
        </div>

        <TabsContent value="tenants" className="mt-0">
          <TenantsView ref={tenantsViewRef} density="compact" />
        </TabsContent>

        <TabsContent value="owners" className="mt-0">
          <OwnersView ref={ownersViewRef} density="compact" />
        </TabsContent>

        <TabsContent value="contacts" className="mt-0">
          <ContactsView />
        </TabsContent>

        <TabsContent value="communications" className="mt-0">
          <CorrespondenceView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PeopleView;
