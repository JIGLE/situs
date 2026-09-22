"use client";

import { createContext, useContext, useMemo } from "react";
import {
  canAccessPortalPath,
  getPortalNavigation,
  getPrimaryMobileNavigation,
  getSecondaryMobileNavigation,
  type PortalNavGroup,
  type PortalNavItem,
} from "@/lib/portal/access";

/**
 * Navigation for the owner application.
 *
 * This used to carry a portal role alongside the nav: `isOwnerPortal`, `isTenantPortal`,
 * `isReadOnly`, and the signed-in tenant's email and id, so the same screens could render a
 * narrowed read-only view to a role=USER session. The scope cutdown removed tenant access,
 * and with it every consumer of those flags — a boolean that is always true reads as a
 * guard and is not one, so it is gone rather than pinned to `true`.
 */
interface PortalContextValue {
  navigation: PortalNavGroup[];
  mobilePrimaryNavigation: PortalNavItem[];
  mobileSecondaryNavigation: PortalNavItem[];
  canAccessPath: (pathname: string) => boolean;
}

const PortalContext = createContext<PortalContextValue>({
  navigation: getPortalNavigation(),
  mobilePrimaryNavigation: getPrimaryMobileNavigation(),
  mobileSecondaryNavigation: getSecondaryMobileNavigation(),
  canAccessPath: () => true,
});

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<PortalContextValue>(
    () => ({
      navigation: getPortalNavigation(),
      mobilePrimaryNavigation: getPrimaryMobileNavigation(),
      mobileSecondaryNavigation: getSecondaryMobileNavigation(),
      canAccessPath: canAccessPortalPath,
    }),
    [],
  );

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalAccess() {
  return useContext(PortalContext);
}
