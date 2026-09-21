"use client";

import React, { createContext, useContext, ReactNode, useMemo } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  Building,
  Property,
  Tenant,
  Receipt,
  CorrespondenceTemplate,
  Correspondence,
  Owner,
  Expense,
  MaintenanceTicket,
  Lease,
} from "@/lib/types";
import { useToast } from "./toast-context";
import { useCsrf } from "./csrf-context";
import { usePortalAccess } from "@/lib/contexts/portal-context";
import { isPublicPagePath } from "@/lib/utils/public-route";
import { appReducer, initialState, type AppAction, type AppState } from "./app-reducer";
import { useAppData } from "./use-app-data";
import { useEntityActions } from "./use-entity-actions";
import { useScopedState } from "./use-scoped-state";

export type { AppState, AppAction } from "./app-reducer";

// ---------------------------------------------------------------------------
// Context type — public API (backward-compatible with all consumers)
// ---------------------------------------------------------------------------

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  addBuilding: (data: Partial<Building>) => Promise<void>;
  updateBuilding: (id: string, data: Partial<Building>) => Promise<void>;
  deleteBuilding: (id: string) => Promise<void>;
  addProperty: (data: Partial<Property>) => Promise<void>;
  updateProperty: (id: string, data: Partial<Property>) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;
  addTenant: (data: Partial<Tenant>) => Promise<void>;
  updateTenant: (id: string, data: Partial<Tenant>) => Promise<void>;
  deleteTenant: (id: string) => Promise<void>;
  addReceipt: (data: Partial<Receipt>) => Promise<void>;
  updateReceipt: (id: string, data: Partial<Receipt>) => Promise<void>;
  deleteReceipt: (id: string) => Promise<void>;
  addTemplate: (data: Partial<CorrespondenceTemplate>) => Promise<void>;
  updateTemplate: (id: string, data: Partial<CorrespondenceTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  addCorrespondence: (data: Partial<Correspondence>) => Promise<void>;
  updateCorrespondence: (id: string, data: Partial<Correspondence>) => Promise<void>;
  deleteCorrespondence: (id: string) => Promise<void>;
  addOwner: (data: Partial<Owner>) => Promise<void>;
  updateOwner: (id: string, data: Partial<Owner>) => Promise<void>;
  deleteOwner: (id: string) => Promise<void>;
  addExpense: (data: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addMaintenance: (data: Partial<MaintenanceTicket>) => Promise<void>;
  updateMaintenance: (id: string, data: Partial<MaintenanceTicket>) => Promise<void>;
  deleteMaintenance: (id: string) => Promise<void>;
  addLease: (data: Partial<Lease>) => Promise<void>;
  updateLease: (id: string, data: Partial<Lease>) => Promise<void>;
  deleteLease: (id: string) => Promise<void>;
  refreshData: () => Promise<void>;
}

export const AppContext = createContext<AppContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider — thin composition layer over the entity hooks
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = React.useReducer(appReducer, initialState);
  const { data: session } = useSession();
  const pathname = usePathname();
  const { portalRole, tenantEmail, tenantId: selectedTenantId } = usePortalAccess();
  const { error: showError, success: showSuccess } = useToast();
  const { token: csrfToken } = useCsrf();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const isPublicPage = isPublicPagePath(pathname);

  const { refreshData } = useAppData({
    dispatch,
    userId,
    csrfToken,
    showError,
    isPublicPage,
  });

  const {
    buildingActions,
    propertyActions,
    tenantActions,
    receiptActions,
    templateActions,
    correspondenceActions,
    ownerActions,
    expenseActions,
    maintenanceActions,
    leaseActions,
  } = useEntityActions(state, dispatch, { csrfToken, userId, showError, showSuccess });

  const scopedState = useScopedState(state, { portalRole, selectedTenantId, tenantEmail });

  // --- context value (backward-compatible shape) ---

  const contextValue: AppContextValue = useMemo(
    () => ({
      state: scopedState,
      dispatch,
      addBuilding: (d) => buildingActions.add(d) as unknown as Promise<void>,
      updateBuilding: (id, d) => buildingActions.update(id, d) as unknown as Promise<void>,
      deleteBuilding: (id) => buildingActions.remove(id),
      addProperty: (d) => propertyActions.add(d) as unknown as Promise<void>,
      updateProperty: (id, d) => propertyActions.update(id, d) as unknown as Promise<void>,
      deleteProperty: (id) => propertyActions.remove(id),
      addTenant: (d) => tenantActions.add(d) as unknown as Promise<void>,
      updateTenant: (id, d) => tenantActions.update(id, d) as unknown as Promise<void>,
      deleteTenant: (id) => tenantActions.remove(id),
      addReceipt: (d) => receiptActions.add(d) as unknown as Promise<void>,
      updateReceipt: (id, d) => receiptActions.update(id, d) as unknown as Promise<void>,
      deleteReceipt: (id) => receiptActions.remove(id),
      addTemplate: (d) => templateActions.add(d) as unknown as Promise<void>,
      updateTemplate: (id, d) => templateActions.update(id, d) as unknown as Promise<void>,
      deleteTemplate: (id) => templateActions.remove(id),
      addCorrespondence: (d) => correspondenceActions.add(d) as unknown as Promise<void>,
      updateCorrespondence: (id, d) =>
        correspondenceActions.update(id, d) as unknown as Promise<void>,
      deleteCorrespondence: (id) => correspondenceActions.remove(id),
      addOwner: (d) => ownerActions.add(d) as unknown as Promise<void>,
      updateOwner: (id, d) => ownerActions.update(id, d) as unknown as Promise<void>,
      deleteOwner: (id) => ownerActions.remove(id),
      addExpense: (d) => expenseActions.add(d) as unknown as Promise<void>,
      deleteExpense: (id) => expenseActions.remove(id),
      addMaintenance: (d) => maintenanceActions.add(d) as unknown as Promise<void>,
      updateMaintenance: (id, d) => maintenanceActions.update(id, d) as unknown as Promise<void>,
      deleteMaintenance: (id) => maintenanceActions.remove(id),
      addLease: (d) => leaseActions.add(d) as unknown as Promise<void>,
      updateLease: (id, d) => leaseActions.update(id, d) as unknown as Promise<void>,
      deleteLease: (id) => leaseActions.remove(id),
      refreshData,
    }),
    [
      scopedState,
      dispatch,
      refreshData,
      buildingActions,
      propertyActions,
      tenantActions,
      receiptActions,
      templateActions,
      correspondenceActions,
      ownerActions,
      expenseActions,
      maintenanceActions,
      leaseActions,
    ],
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
