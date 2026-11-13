"use client";

import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, ChevronDown, ChevronRight } from "lucide-react";

import { useCurrency } from "@/lib/contexts/currency-context";
import { countryLabel } from "@/lib/design/country-themes";
import { cn } from "@/lib/utils/utils";
import type { Building, Lease, Property, Tenant } from "@/lib/types";

/** A lease is in its renewal window when it is active and ends within 60 days. */
const RENEWAL_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Structural Portfolio Inventory — the Situs tree view.
 *
 * Hierarchy is derived from real data, not stored: country → cluster
 * (building, or city for standalone properties) → asset. Each asset carries
 * an attention strip of square status dots: danger = tenant payment overdue,
 * info = lease renewal due.
 *
 * The tree lives in a narrow rail attached to the sidebar, so a row carries only what
 * identifies an asset and whether it needs attention — the address, the rent and every
 * other attribute are on the detail page the rail selects into.
 */

interface PortfolioTreeProps {
  properties: Property[];
  buildings: Building[];
  tenants: Tenant[];
  leases?: Lease[];
  onSelectProperty?: (propertyId: string) => void;
  /** Opens a building: its units, their permilagens and its shared expenses. */
  onOpenBuilding?: (buildingId: string) => void;
  highlightedPropertyId?: string;
}

interface AssetNode {
  property: Property;
  overdue: boolean;
  renewalDue: boolean;
}

interface ClusterNode {
  key: string;
  label: string;
  /** Set when the cluster is a building rather than a town. */
  buildingId?: string;
  assets: AssetNode[];
}

interface CountryNode {
  code: string;
  label: string;
  clusters: ClusterNode[];
  assetCount: number;
}

export function PortfolioTree({
  properties,
  buildings,
  tenants,
  leases = [],
  onSelectProperty,
  onOpenBuilding,
  highlightedPropertyId,
}: PortfolioTreeProps): React.ReactElement {
  const t = useTranslations("portfolioTree");
  const tStatus = useTranslations("propertyDetail.status");
  const tLeases = useTranslations("leases");
  const { formatCurrency } = useCurrency();
  const locale = useLocale();

  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const toggleNode = useCallback((key: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const tree = useMemo<CountryNode[]>(() => {
    const buildingsById = new Map(buildings.map((b) => [b.id, b]));
    const overdueByProperty = new Set(
      tenants
        .filter((tn) => tn.paymentStatus === "overdue" && tn.propertyId)
        .map((tn) => tn.propertyId as string),
    );
    // Info signal: an active lease entering its 60-day renewal window.
    const renewalDueByProperty = new Set<string>();
    const renewalCutoff = Date.now() + RENEWAL_WINDOW_MS;
    for (const lease of leases) {
      if (lease.status !== "active" || !lease.propertyId) continue;
      const end = Date.parse(lease.endDate);
      if (!Number.isNaN(end) && end > Date.now() && end <= renewalCutoff) {
        renewalDueByProperty.add(lease.propertyId);
      }
    }

    const countries = new Map<string, Map<string, ClusterNode>>();
    for (const property of properties) {
      const building = property.buildingId ? buildingsById.get(property.buildingId) : undefined;
      const code = (property.country || building?.country || "PT").toUpperCase().slice(0, 2);
      const clusterKey = building ? `b:${building.id}` : `c:${property.city || "—"}`;
      const clusterLabel = building?.name || property.city || t("unclustered");

      let clusters = countries.get(code);
      if (!clusters) {
        clusters = new Map();
        countries.set(code, clusters);
      }
      let cluster = clusters.get(clusterKey);
      if (!cluster) {
        cluster = { key: clusterKey, label: clusterLabel, buildingId: building?.id, assets: [] };
        clusters.set(clusterKey, cluster);
      }
      cluster.assets.push({
        property,
        overdue: overdueByProperty.has(property.id),
        renewalDue: renewalDueByProperty.has(property.id),
      });
    }

    // A building with no unit yet is listed too, so it can be opened to choose its units.
    const placedBuildings = new Set(properties.map((p) => p.buildingId).filter(Boolean));
    for (const building of buildings) {
      if (placedBuildings.has(building.id)) continue;
      const code = (building.country || "PT").toUpperCase().slice(0, 2);
      let clusters = countries.get(code);
      if (!clusters) {
        clusters = new Map();
        countries.set(code, clusters);
      }
      clusters.set(`b:${building.id}`, {
        key: `b:${building.id}`,
        label: building.name,
        buildingId: building.id,
        assets: [],
      });
    }

    return Array.from(countries.entries())
      .map(([code, clusters]) => {
        const clusterList = Array.from(clusters.values())
          .map((c) => ({
            ...c,
            assets: [...c.assets].sort((a, b) => a.property.name.localeCompare(b.property.name)),
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return {
          code,
          label: countryLabel(code, locale),
          clusters: clusterList,
          assetCount: clusterList.reduce((sum, c) => sum + c.assets.length, 0),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [properties, buildings, tenants, leases, t, locale]);

  /** One property's row; `indent` places its label under its cluster's, or flush when flat. */
  const renderAsset = ({ property, overdue, renewalDue }: AssetNode, indent: string) => {
    const highlighted = property.id === highlightedPropertyId;
    return (
      <button
        key={property.id}
        type="button"
        role="treeitem"
        onClick={() => onSelectProperty?.(property.id)}
        title={property.name}
        className={cn(
          "flex w-full items-center gap-2 border-l-2 py-1.5 pr-2 text-left transition-colors max-md:min-h-11",
          indent,
          highlighted
            ? "border-[var(--country-highlight-readable)] bg-[var(--color-hover)]"
            : "border-transparent hover:bg-[var(--color-hover)]",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{property.name}</span>
          {/* Below `lg` the tree is the whole list, not a rail beside the
                detail, so a bare name told a phone nothing. One muted line
                says how much it lets for and how it stands. Overdue takes the
                place of "occupied", which it implies, and names the dot a phone
                has no hover to explain. */}
          <span className="block truncate text-xs text-[var(--color-muted-foreground)] lg:hidden">
            {tLeases("perMonth", { amount: formatCurrency(property.rent) })} ·{" "}
            {overdue ? (
              <span className="text-[var(--semantic-danger-readable)]">{t("dotOverdue")}</span>
            ) : (
              tStatus(property.status)
            )}
          </span>
        </span>
        {/* Attention strip — square semantic dots, quiet when healthy */}
        <span className="flex shrink-0 items-center gap-1">
          {overdue && (
            <span
              className="status-dot status-dot-danger"
              title={t("dotOverdue")}
              aria-label={t("dotOverdue")}
            />
          )}
          {renewalDue && (
            <span
              className="status-dot status-dot-info"
              title={t("dotLease")}
              aria-label={t("dotLease")}
            />
          )}
        </span>
      </button>
    );
  };

  if (properties.length === 0 && buildings.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("empty")}</p>
      </div>
    );
  }

  // One country and one group (no buildings, one city or none): the two heading rows above the
  // properties said nothing, so the list is shown flat.
  if (tree.length === 1 && tree[0].clusters.length === 1 && !tree[0].clusters[0].buildingId) {
    return (
      <div role="tree" aria-label={t("title")} className="py-2">
        {tree[0].clusters[0].assets.map((asset) => renderAsset(asset, "pl-3"))}
      </div>
    );
  }

  return (
    <div role="tree" aria-label={t("title")} className="py-2">
      {tree.map((country) => {
        const countryKey = `country:${country.code}`;
        const countryCollapsed = collapsedNodes.has(countryKey);
        return (
          <div key={country.code} role="treeitem" aria-expanded={!countryCollapsed}>
            {/* Country row — chevron at 8px, label at 30px */}
            <button
              type="button"
              onClick={() => toggleNode(countryKey)}
              className="flex w-full items-center gap-2 border-l-2 border-transparent px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-hover)] max-md:min-h-11"
            >
              {countryCollapsed ? (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{country.label}</span>
              <span className="mono-label whitespace-nowrap">{country.assetCount}</span>
            </button>

            {!countryCollapsed &&
              country.clusters.map((cluster) => {
                const clusterKey = `${countryKey}/${cluster.key}`;
                const clusterNodeCollapsed = collapsedNodes.has(clusterKey);
                return (
                  <div key={cluster.key} role="treeitem" aria-expanded={!clusterNodeCollapsed}>
                    {/* Cluster row — chevron at 24px, label at 46px. A building's row also opens
                        the building, beside the toggle rather than inside it. */}
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => toggleNode(clusterKey)}
                        className="flex min-w-0 flex-1 items-center gap-2 border-l-2 border-transparent py-1.5 pl-6 pr-2 text-left transition-colors hover:bg-[var(--color-hover)] max-md:min-h-11"
                      >
                        {clusterNodeCollapsed ? (
                          <ChevronRight
                            className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronDown
                            className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-muted-foreground)]">
                          {cluster.label}
                        </span>
                        <span className="mono-label">{cluster.assets.length}</span>
                      </button>
                      {cluster.buildingId && onOpenBuilding && (
                        <button
                          type="button"
                          onClick={() => onOpenBuilding(cluster.buildingId!)}
                          aria-label={t("openBuilding", { name: cluster.label })}
                          title={t("openBuilding", { name: cluster.label })}
                          className="flex w-8 shrink-0 items-center justify-center text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-foreground)] max-md:min-h-11 max-md:w-11"
                        >
                          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {/* Asset rows — label at 56px, one step past its cluster's label so the
                        hierarchy survives without a chevron of its own to mark the level. */}
                    {!clusterNodeCollapsed &&
                      cluster.assets.map((asset) => renderAsset(asset, "pl-14"))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
