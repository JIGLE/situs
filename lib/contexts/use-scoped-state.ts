/**
 * Tenant-portal state scoping for AppProvider.
 *
 * When the active portal role is "tenant", the global AppState is narrowed to
 * only the rows that tenant is allowed to see (their properties, leases,
 * receipts, and correspondence). For all other roles the state is
 * returned unchanged. Extracted from app-context.tsx.
 */

import { useMemo } from "react";
import type { AppState } from "./app-reducer";

interface ScopeParams {
  portalRole: string | null | undefined;
  selectedTenantId?: string | null;
  tenantEmail?: string | null;
}

export function useScopedState(state: AppState, params: ScopeParams): AppState {
  const { portalRole, selectedTenantId, tenantEmail } = params;

  return useMemo(() => {
    if (portalRole !== "tenant") {
      return state;
    }

    const activeTenant =
      (selectedTenantId
        ? state.tenants.find((tenant) => tenant.id === selectedTenantId)
        : undefined) ??
      (tenantEmail ? state.tenants.find((tenant) => tenant.email === tenantEmail) : undefined);

    if (!activeTenant) {
      return {
        ...state,
        properties: [],
        tenants: [],
        receipts: [],
        templates: [],
        correspondence: [],
        owners: [],
        expenses: [],
        leases: [],
      };
    }

    const tenantPropertyIds = new Set(
      [
        activeTenant.propertyId,
        ...state.leases
          .filter((lease) => lease.tenantId === activeTenant.id)
          .map((lease) => lease.propertyId),
      ].filter(Boolean) as string[],
    );

    return {
      ...state,
      properties: state.properties.filter((property) => tenantPropertyIds.has(property.id)),
      tenants: [activeTenant],
      receipts: state.receipts.filter((receipt) => receipt.tenantId === activeTenant.id),
      templates: [],
      correspondence: state.correspondence.filter(
        (correspondence) => correspondence.tenantId === activeTenant.id,
      ),
      owners: [],
      expenses: [],
      leases: state.leases.filter((lease) => lease.tenantId === activeTenant.id),
    };
  }, [portalRole, selectedTenantId, state, tenantEmail]);
}
