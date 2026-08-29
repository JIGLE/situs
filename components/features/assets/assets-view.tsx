"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  CreditCard,
  FileText,
  Home,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PropertiesView, PropertiesViewRef } from "@/components/features/property/property-list";
import { PortfolioSummary } from "@/components/features/property/portfolio-summary";
import { ExportButton, ExportColumn } from "@/components/ui/export-button";
import { useApp } from "@/lib/contexts/app-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePortalAccess } from "@/lib/contexts/portal-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { getActiveLease } from "@/lib/utils/lease-helpers";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function TenantStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-[var(--color-foreground)]">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function AssetsView(): React.ReactElement {
  const { state, addBuilding } = useApp();
  const { isOwnerPortal } = usePortalAccess();
  const { formatCurrency } = useCurrency();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { properties, leases, receipts, tenants } = state;
  const propertiesViewRef = useRef<PropertiesViewRef>(null);
  const t = useTranslations("portfolio");

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
    country: "PT",
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
        country: buildingForm.country,
      });
      setBuildingDialogOpen(false);
      setBuildingForm({ name: "", address: "", city: "", country: "PT" });
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

  const tenantHome = useMemo(() => {
    const tenant = tenants[0];
    const activeLease = tenant ? getActiveLease(tenant.id, leases) : null;
    const property = properties.find(
      (item) => item.id === (activeLease?.propertyId ?? tenant?.propertyId),
    );
    const paidReceipts = receipts.filter((r) => r.status === "paid");
    return { tenant, activeLease, property, paidReceipts };
  }, [leases, properties, receipts, tenants]);

  if (!isOwnerPortal) {
    // ── Tenant view ─────────────────────────────────────────────────────────────
    return (
      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-sm">
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <Badge
                variant="outline"
                className="w-fit border-[var(--color-primary)]/20 bg-[var(--color-info-muted)] text-[var(--color-primary)]"
              >
                {t("tenant.badge")}
              </Badge>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
                <Building2 className="h-8 w-8" />
                {tenantHome.property?.name ?? t("tenant.myHome")}
              </h1>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => router.push("/financials")}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  {t("tenant.payments")}
                </Button>
                <Button variant="outline" onClick={() => router.push("/leases")}>
                  <Receipt className="mr-2 h-4 w-4" />
                  {t("tenant.myLease")}
                </Button>
                <Button variant="outline" onClick={() => router.push("/documents")}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t("tenant.myDocuments")}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <TenantStatCard
                label={t("tenant.monthlyRent")}
                value={formatCurrency(
                  tenantHome.activeLease?.monthlyRent ?? tenantHome.property?.rent ?? 0,
                )}
                detail={
                  tenantHome.activeLease
                    ? t("tenant.leaseEnds", { date: tenantHome.activeLease.endDate })
                    : t("tenant.noLease")
                }
              />
              <TenantStatCard
                label={t("tenant.receipts")}
                value={`${tenantHome.paidReceipts.length}`}
                detail={t("tenant.paidRecords")}
              />
              <Card className="md:col-span-2">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
                        <p className="font-medium text-[var(--color-foreground)]">
                          {t("tenant.homeSummary")}
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
                        {tenantHome.property?.address ?? t("tenant.addressUnavailable")}
                      </p>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {tenantHome.property?.status ?? "active"}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                    <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
                    {tenantHome.property?.latitude && tenantHome.property?.longitude
                      ? t("tenant.mapAvailable")
                      : t("tenant.mapUnavailable")}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <PropertiesView ref={propertiesViewRef} density="compact" showPageHeader={false} />
      </div>
    );
  }

  // ── Owner portal view ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Compact page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Title alone. These same figures used to trail the heading as a subtitle AND are
              what the workspace summary is for; one screen stating a number twice is the thing
              the declutter rule in CLAUDE.md exists to stop. */}
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
            {t("title")}
          </h1>
        </div>
      </div>

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
                  <span className="ml-auto text-[11px] text-[var(--color-muted-foreground)]">
                    {t("newPropertyHint")}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setBuildingDialogOpen(true)}>
                  <Building2 className="mr-2 h-3.5 w-3.5" />
                  {t("newBuilding")}
                  <span className="ml-auto text-[11px] text-[var(--color-muted-foreground)]">
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

      {/* Add Building dialog */}
      <Dialog open={buildingDialogOpen} onOpenChange={setBuildingDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Building</DialogTitle>
            <DialogDescription>
              Create a building to group related properties together.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddBuilding} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="building-name">Building Name *</Label>
              <Input
                id="building-name"
                placeholder="e.g. Riverside Apartments"
                value={buildingForm.name}
                onChange={(e) => setBuildingForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="building-city">City</Label>
                <Input
                  id="building-city"
                  value={buildingForm.city}
                  onChange={(e) => setBuildingForm((f) => ({ ...f, city: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="building-country">Country</Label>
                <Select
                  value={buildingForm.country}
                  onValueChange={(v) => setBuildingForm((f) => ({ ...f, country: v }))}
                >
                  <SelectTrigger id="building-country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PT">Portugal</SelectItem>
                    <SelectItem value="ES">Spain</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="building-address">Address</Label>
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
                Cancel
              </Button>
              <Button
                type="submit"
                loading={buildingSubmitting}
                disabled={!buildingForm.name.trim()}
              >
                Create Building
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AssetsView;
