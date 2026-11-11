"use client";

import { PageHeader } from "@/components/shared/page-header";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Home, Plus } from "lucide-react";
import { PropertiesView, PropertiesViewRef } from "@/components/features/property/property-list";
import { LeasesView } from "@/components/features/lease/leases-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortfolioSummary } from "@/components/features/property/portfolio-summary";
import { ExportButton, ExportColumn } from "@/components/ui/export-button";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type PortfolioTab = "properties" | "leases";

const tabOf = (value: string | null): PortfolioTab =>
  value === "leases" ? "leases" : "properties";

export function AssetsView(): React.ReactElement {
  const { state, addBuilding } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Leases is a tab here, not a menu entry of its own: a lease is a property's tenancy.
  // `?tab=leases` opens it, which is where `/leases` and its links (`?action=create`, …) land.
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<PortfolioTab>(() => tabOf(tabParam));
  useEffect(() => setTab(tabOf(tabParam)), [tabParam]);
  const selectTab = (next: string) => {
    const value = tabOf(next);
    setTab(value);
    // Kept in the address, so a reload or a shared link opens the same tab. Through the History
    // API: `router.replace` would mount the screen afresh.
    const params = new URLSearchParams(searchParams.toString());
    if (value === "leases") params.set("tab", "leases");
    else params.delete("tab");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  };
  const { properties } = state;
  const propertiesViewRef = useRef<PropertiesViewRef>(null);
  const t = useTranslations("portfolio");
  const tForms = useTranslations("forms");
  const tActions = useTranslations("actions");
  const tNav = useTranslations("navigation");
  const { success } = useToast();

  // Onboarding checklist deep-links here with ?action=create-property
  // (`overview-view.tsx`'s handleAddProperty) expecting the create dialog to open
  // automatically — previously nothing read this param, so the first onboarding step
  // silently dropped the user on an empty portfolio page instead.
  useEffect(() => {
    if (searchParams.get("action") === "create-property") {
      propertiesViewRef.current?.openDialog();
      router.replace("/portfolio");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Add-building dialog state
  const [buildingDialogOpen, setBuildingDialogOpen] = useState(false);
  const [buildingForm, setBuildingForm] = useState({
    name: "",
    address: "",
    city: "",
  });
  const [buildingSubmitting, setBuildingSubmitting] = useState(false);

  const handleAddBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingForm.name.trim()) return;
    setBuildingSubmitting(true);
    try {
      await addBuilding({
        name: buildingForm.name.trim(),
        address: buildingForm.address.trim(),
        city: buildingForm.city.trim(),
      });
      // The only feedback this save had was the action's own English "Building added
      // successfully", which the action no longer shows: a success belongs to the screen.
      success(t("toastBuildingCreated"));
      setBuildingDialogOpen(false);
      setBuildingForm({ name: "", address: "", city: "" });
    } catch {
      // The action has already reported the failure; the dialog stays open for another try.
    } finally {
      setBuildingSubmitting(false);
    }
  };

  const propertyColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "address", label: "Address" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "bedrooms", label: "Bedrooms" },
    { key: "bathrooms", label: "Bathrooms" },
    { key: "rent", label: "Rent" },
  ];

  return (
    <div className="space-y-5">
      {/* Title alone. These same figures used to trail the heading as a subtitle AND are what the
          workspace summary is for; one screen stating a number twice is the thing the declutter
          rule in CLAUDE.md exists to stop. */}
      {/* The heading is the menu label, so the page you land on is named as the link you
          tapped (it read "Pagamentos" under "Finanças", "Gestão de Contratos" under "Contratos"). */}
      <PageHeader title={tNav("portfolio")} />

      <Tabs value={tab} onValueChange={selectTab} className="space-y-5">
        <TabsList>
          <TabsTrigger value="properties">{t("tabs.portfolioList")}</TabsTrigger>
          <TabsTrigger value="leases">{tNav("leases")}</TabsTrigger>
        </TabsList>

        <TabsContent value="properties" className="mt-0">
          {/* Portfolio inventory — tree + workspace (table available via the toggle). Create and
          export are handed down as tree actions so they sit with the asset list rather than
          floating in the page header above it. */}
          <PropertiesView
            ref={propertiesViewRef}
            density="compact"
            showPageHeader={false}
            workspaceDefault={<PortfolioSummary />}
            treeActions={
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="h-8 flex-1 gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      {t("newAsset")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    <DropdownMenuItem onClick={() => propertiesViewRef.current?.openDialog()}>
                      <Home className="mr-2 h-3.5 w-3.5" />
                      {t("newProperty")}
                      <span className="ml-auto text-caption text-[var(--color-muted-foreground)]">
                        {t("newPropertyHint")}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setBuildingDialogOpen(true)}>
                      <Building2 className="mr-2 h-3.5 w-3.5" />
                      {t("newBuilding")}
                      <span className="ml-auto text-caption text-[var(--color-muted-foreground)]">
                        {t("newBuildingHint")}
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ExportButton
                  data={properties}
                  filename="properties-export"
                  columns={propertyColumns}
                />
              </>
            }
          />
        </TabsContent>

        <TabsContent value="leases" className="mt-0">
          <LeasesView embedded />
        </TabsContent>
      </Tabs>

      {/* Add Building dialog */}
      <Dialog open={buildingDialogOpen} onOpenChange={setBuildingDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("buildingDialog.title")}</DialogTitle>
            <DialogDescription>{t("buildingDialog.description")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddBuilding} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="building-name">{t("buildingDialog.name")}</Label>
              <Input
                id="building-name"
                placeholder={t("buildingDialog.namePlaceholder")}
                value={buildingForm.name}
                onChange={(e) => setBuildingForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="building-city">{tForms("city")}</Label>
                <Input
                  id="building-city"
                  value={buildingForm.city}
                  onChange={(e) => setBuildingForm((f) => ({ ...f, city: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="building-address">{tForms("address")}</Label>
              <Input
                id="building-address"
                value={buildingForm.address}
                onChange={(e) => setBuildingForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBuildingDialogOpen(false)}
                disabled={buildingSubmitting}
              >
                {tActions("cancel")}
              </Button>
              <Button
                type="submit"
                loading={buildingSubmitting}
                disabled={!buildingForm.name.trim()}
              >
                {t("buildingDialog.submit")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AssetsView;
