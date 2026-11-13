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
 * Hierarchy is derived from real data, not stored: country → city → asset, where a building
 * is a heading inside its city with its units listed under it. Only the country and the city
 * fold; a building does not, since it groups a city's units rather than hiding them. Each asset carries
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

/** A building inside its city: a heading, not a fold, with its units under it. */
interface BuildingGroup {
  id: string;
  name: string;
  assets: AssetNode[];
}

interface ClusterNode {
  key: string;
  label: string;
  /** The city's properties in no building. */
  assets: AssetNode[];
  buildings: BuildingGroup[];
  assetCount: number;
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

    interface CityDraft {
      label: string;
      assets: AssetNode[];
      buildings: Map<string, BuildingGroup>;
    }
    const countries = new Map<string, Map<string, CityDraft>>();
    const cityOf = (code: string, city: string | undefined): CityDraft => {
      let cities = countries.get(code);
      if (!cities) {
        cities = new Map();
        countries.set(code, cities);
      }
      const label = city?.trim() || t("unclustered");
      const key = label.toLocaleLowerCase(locale);
      let draft = cities.get(key);
      if (!draft) {
        draft = { label, assets: [], buildings: new Map() };
        cities.set(key, draft);
      }
      return draft;
    };
    const groupOf = (building: Building, firstUnit?: Property): BuildingGroup => {
      const code = (building.country || firstUnit?.country || "PT").toUpperCase().slice(0, 2);
      const city = cityOf(code, building.city || firstUnit?.city);
      let group = city.buildings.get(building.id);
      if (!group) {
        group = { id: building.id, name: building.name, assets: [] };
        city.buildings.set(building.id, group);
      }
      return group;
    };

    for (const property of properties) {
      const asset: AssetNode = {
        property,
        overdue: overdueByProperty.has(property.id),
        renewalDue: renewalDueByProperty.has(property.id),
      };
      const building = property.buildingId ? buildingsById.get(property.buildingId) : undefined;
      if (building) {
        // A building sits in one city, its own or its first unit's, with all its units.
        groupOf(building, property).assets.push(asset);
        continue;
      }
      const code = (property.country || "PT").toUpperCase().slice(0, 2);
      cityOf(code, property.city).assets.push(asset);
    }

    // A building with no unit yet is listed too, so it can be opened to choose its units.
    const placedBuildings = new Set(properties.map((p) => p.buildingId).filter(Boolean));
    for (const building of buildings) {
      if (!placedBuildings.has(building.id)) groupOf(building);
    }

    const byName = (a: AssetNode, b: AssetNode) =>
      a.property.name.localeCompare(b.property.name, locale, { numeric: true });
    return Array.from(countries.entries())
      .map(([code, cities]) => {
        const clusterList: ClusterNode[] = Array.from(cities.entries())
          .map(([key, c]) => {
            const groups = Array.from(c.buildings.values())
              .map((g) => ({ ...g, assets: [...g.assets].sort(byName) }))
              .sort((a, b) => a.name.localeCompare(b.name, locale));
            return {
              key: `c:${key}`,
              label: c.label,
              assets: [...c.assets].sort(byName),
              buildings: groups,
              assetCount: c.assets.length + groups.reduce((sum, g) => sum + g.assets.length, 0),
            };
          })
          .sort((a, b) => a.label.localeCompare(b.label, locale));
        return {
          code,
          label: countryLabel(code, locale),
          clusters: clusterList,
          assetCount: clusterList.reduce((sum, c) => sum + c.assetCount, 0),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, locale));
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
            {/* No rent yet (a vacant unit, a garage not let) says nothing rather than "0,00 €". */}
            {property.rent > 0 && (
              <>{tLeases("perMonth", { amount: formatCurrency(property.rent) })} · </>
            )}
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
  if (
    tree.length === 1 &&
    tree[0].clusters.length === 1 &&
    tree[0].clusters[0].buildings.length === 0
  ) {
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
                    {/* City row — chevron at 24px, label at 46px. */}
                    <button
                      type="button"
                      onClick={() => toggleNode(clusterKey)}
                      className="flex w-full items-center gap-2 border-l-2 border-transparent py-1.5 pl-6 pr-2 text-left transition-colors hover:bg-[var(--color-hover)] max-md:min-h-11"
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
                      <span className="mono-label">{cluster.assetCount}</span>
                    </button>

                    {/* Asset rows — label at 56px, one step past its city's label so the
                        hierarchy survives without a chevron of its own to mark the level. */}
                    {!clusterNodeCollapsed && (
                      <>
                        {cluster.assets.map((asset) => renderAsset(asset, "pl-14"))}
                        {cluster.buildings.map((group) => (
                          <div key={group.id} role="group" aria-label={group.name}>
                            {/* The building is a heading inside its city, not a fold: it opens
                                the building, and its units are always listed under it. */}
                            <button
                              type="button"
                              onClick={() => onOpenBuilding?.(group.id)}
                              disabled={!onOpenBuilding}
                              title={t("openBuilding", { name: group.name })}
                              aria-label={t("openBuilding", { name: group.name })}
                              className="mt-1 flex w-full items-center gap-2 border-l-2 border-transparent py-1.5 pl-14 pr-2 text-left transition-colors hover:bg-[var(--color-hover)] disabled:hover:bg-transparent max-md:min-h-11"
                            >
                              <Building2
                                className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]"
                                aria-hidden="true"
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-muted-foreground)]">
                                {group.name}
                              </span>
                              <span className="mono-label">{group.assets.length}</span>
                            </button>
                            {group.assets.map((asset) => renderAsset(asset, "pl-[4.75rem]"))}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
