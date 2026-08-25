"use client";

import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";

import { COUNTRY_THEMES, isCountryCode } from "@/lib/design/country-themes";
import { cn } from "@/lib/utils/utils";
import type { Building, Lease, MaintenanceTicket, Property, Tenant } from "@/lib/types";

/** A lease is in its renewal window when it is active and ends within 60 days. */
const RENEWAL_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Structural Portfolio Inventory — the Situs tree view.
 *
 * Hierarchy is derived from real data, not stored: country → cluster
 * (building, or city for standalone properties) → asset. Each asset carries
 * an attention strip of square status dots: danger = tenant payment overdue,
 * warning = open maintenance tickets, info = lease renewal due.
 *
 * The tree lives in a narrow rail attached to the sidebar, so a row carries only what
 * identifies an asset and whether it needs attention — the address, the rent and every
 * other attribute are on the detail page the rail selects into.
 */

interface PortfolioTreeProps {
  properties: Property[];
  buildings: Building[];
  tenants: Tenant[];
  maintenance: MaintenanceTicket[];
  leases?: Lease[];
  onSelectProperty?: (propertyId: string) => void;
  highlightedPropertyId?: string;
}

interface AssetNode {
  property: Property;
  overdue: boolean;
  openTickets: number;
  renewalDue: boolean;
}

interface ClusterNode {
  key: string;
  label: string;
  assets: AssetNode[];
}

interface CountryNode {
  code: string;
  label: string;
  clusters: ClusterNode[];
  assetCount: number;
}

/**
 * The country's name in the reader's language.
 *
 * This used to return `COUNTRY_THEMES[code].name`, which is an English string in a 28-country
 * table — so the portfolio tree said "Spain" to a Portuguese reader, and would have said
 * "Germany" and "France" to them too. Translating the table would mean 28 names times four
 * catalogues, maintained by hand, growing with every country added.
 *
 * `Intl.DisplayNames` already knows them, in every locale the app has and every one it might
 * add: ES renders as Espanha / España / Spagna / Spain with nothing to maintain. It even covers
 * the table's one non-ISO entry — EU comes back as "União Europeia".
 *
 * The table's `name` stays as the fallback for a code the platform does not recognise.
 */
function countryLabel(code: string, locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: "region" }).of(code);
    if (display && display !== code) return display;
  } catch {
    // Unsupported locale or a code that is not a region — fall through to the table.
  }
  return isCountryCode(code) ? COUNTRY_THEMES[code].name : code;
}

export function PortfolioTree({
  properties,
  buildings,
  tenants,
  maintenance,
  leases = [],
  onSelectProperty,
  highlightedPropertyId,
}: PortfolioTreeProps): React.ReactElement {
  const t = useTranslations("portfolioTree");
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
    const openTicketsByProperty = new Map<string, number>();
    for (const ticket of maintenance) {
      if (ticket.status === "open" || ticket.status === "in_progress") {
        openTicketsByProperty.set(
          ticket.propertyId,
          (openTicketsByProperty.get(ticket.propertyId) ?? 0) + 1,
        );
      }
    }
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
      const code = (property.propertyCountry || property.country || building?.country || "PT")
        .toUpperCase()
        .slice(0, 2);
      const clusterKey = building ? `b:${building.id}` : `c:${property.city || "—"}`;
      const clusterLabel = building?.name || property.city || t("unclustered");

      let clusters = countries.get(code);
      if (!clusters) {
        clusters = new Map();
        countries.set(code, clusters);
      }
      let cluster = clusters.get(clusterKey);
      if (!cluster) {
        cluster = { key: clusterKey, label: clusterLabel, assets: [] };
        clusters.set(clusterKey, cluster);
      }
      cluster.assets.push({
        property,
        overdue: overdueByProperty.has(property.id),
        openTickets: openTicketsByProperty.get(property.id) ?? 0,
        renewalDue: renewalDueByProperty.has(property.id),
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
  }, [properties, buildings, tenants, maintenance, leases, t, locale]);

  if (properties.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("empty")}</p>
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
                    {/* Cluster row — chevron at 24px, label at 46px */}
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
                      <span className="mono-label">{cluster.assets.length}</span>
                    </button>

                    {/* Asset rows — label at 56px, one step past its cluster's label so the
                        hierarchy survives without a chevron of its own to mark the level. */}
                    {!clusterNodeCollapsed &&
                      cluster.assets.map(({ property, overdue, openTickets, renewalDue }) => {
                        const highlighted = property.id === highlightedPropertyId;
                        return (
                          <button
                            key={property.id}
                            type="button"
                            role="treeitem"
                            onClick={() => onSelectProperty?.(property.id)}
                            title={property.name}
                            className={cn(
                              "flex w-full items-center gap-2 border-l-2 py-1.5 pl-14 pr-2 text-left transition-colors max-md:min-h-11",
                              highlighted
                                ? "border-[var(--country-highlight-readable)] bg-[var(--color-hover)]"
                                : "border-transparent hover:bg-[var(--color-hover)]",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">{property.name}</span>
                            {/* Attention strip — square semantic dots, quiet when healthy */}
                            <span className="flex shrink-0 items-center gap-1">
                              {overdue && (
                                <span
                                  className="status-dot status-dot-danger"
                                  title={t("dotOverdue")}
                                  aria-label={t("dotOverdue")}
                                />
                              )}
                              {openTickets > 0 && (
                                <span
                                  className="status-dot status-dot-warn"
                                  title={t("dotTickets")}
                                  aria-label={t("dotTickets")}
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
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
