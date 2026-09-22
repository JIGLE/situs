"use client";

import { useSearchParams } from "next/navigation";
import { parseEntityDetail } from "@/lib/utils/entity-detail-url";
import { PropertyDetailOverlayClient } from "@/components/features/property/property-detail-overlay-client";
import { TenantDetailOverlayClient } from "@/components/features/tenant/tenant-detail-overlay-client";
import { OwnerDetailOverlayClient } from "@/components/features/owner/owner-detail-overlay-client";
import { LeaseDetailOverlayClient } from "@/components/features/lease/lease-detail-overlay-client";

/**
 * Mounted once in the authenticated shell (`app/[locale]/(main)/layout.tsx`),
 * so `?detail=<type>:<id>` opens the matching entity overlay from any page —
 * e.g. a tenant name clicked from the Finance Payment Matrix opens the tenant
 * overlay without navigating to People first. Generalizes what used to be a
 * Portfolio-only `?modal=<id>` mechanism.
 */
export function EntityDetailRouteClient() {
  const searchParams = useSearchParams();
  const detail = parseEntityDetail(searchParams.get("detail"));
  if (!detail) return null;

  switch (detail.type) {
    case "property":
      return <PropertyDetailOverlayClient id={detail.id} />;
    case "tenant":
      return <TenantDetailOverlayClient id={detail.id} />;
    case "owner":
      return <OwnerDetailOverlayClient id={detail.id} />;
    case "lease":
      return <LeaseDetailOverlayClient id={detail.id} />;
    default:
      return null;
  }
}
