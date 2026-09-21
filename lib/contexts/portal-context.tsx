"use client";

import { createContext, useContext, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  canAccessPortalPath,
  getPortalNavigation,
  getPortalRoleFromSessionRole,
  getPrimaryMobileNavigation,
  getSecondaryMobileNavigation,
  type PortalRole,
  type PortalNavGroup,
  type PortalNavItem,
} from "@/lib/portal/access";

interface PortalContextValue {
  portalRole: PortalRole;
  isOwnerPortal: boolean;
  isTenantPortal: boolean;
  isReadOnly: boolean;
  navigation: PortalNavGroup[];
  mobilePrimaryNavigation: PortalNavItem[];
  mobileSecondaryNavigation: PortalNavItem[];
  canAccessPath: (pathname: string) => boolean;
  tenantEmail?: string | null;
  tenantId?: string | null;
}

const PortalContext = createContext<PortalContextValue>({
  portalRole: "owner",
  isOwnerPortal: true,
  isTenantPortal: false,
  isReadOnly: false,
  navigation: getPortalNavigation("owner"),
  mobilePrimaryNavigation: getPrimaryMobileNavigation("owner"),
  mobileSecondaryNavigation: getSecondaryMobileNavigation("owner"),
  canAccessPath: () => true,
  tenantEmail: null,
  tenantId: null,
});

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const portalRole = getPortalRoleFromSessionRole(session?.user?.role ?? null);

  const value = useMemo<PortalContextValue>(() => {
    const navigation = getPortalNavigation(portalRole);
    return {
      portalRole,
      isOwnerPortal: portalRole === "owner",
      isTenantPortal: portalRole === "tenant",
      isReadOnly: portalRole === "tenant",
      navigation,
      mobilePrimaryNavigation: getPrimaryMobileNavigation(portalRole),
      mobileSecondaryNavigation: getSecondaryMobileNavigation(portalRole),
      canAccessPath: (pathname: string) => canAccessPortalPath(portalRole, pathname),
      tenantEmail: session?.user?.email ?? null,
      tenantId: null,
    };
  }, [portalRole, session?.user?.email]);

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortalAccess() {
  return useContext(PortalContext);
}
