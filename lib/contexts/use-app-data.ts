/**
 * Data-loading hook for AppProvider.
 *
 * Encapsulates the initial fetch of every entity collection (live API, demo
 * bundle, or public-route no-op) plus the request-storm guard. Extracted from
 * app-context.tsx to keep the provider a thin composition layer.
 */

import { useCallback, useEffect, useRef } from "react";
import type React from "react";
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
import { apiFetch } from "@/lib/utils/api-client";
import { useApiError } from "@/lib/utils/api-error";
import { isDemoModeClient } from "@/lib/demo/demo-mode";
import { getDemoData } from "@/lib/demo/demo-data";
import type { AppAction } from "./app-reducer";

interface UseAppDataParams {
  dispatch: React.Dispatch<AppAction>;
  userId?: string;
  csrfToken: string | null;
  showError: (msg: string) => void;
  isPublicPage: boolean;
  isDemo: boolean;
}

interface UseAppDataResult {
  refreshData: () => Promise<void>;
}

export function useAppData({
  dispatch,
  userId,
  csrfToken,
  showError,
  isPublicPage,
  isDemo,
}: UseAppDataParams): UseAppDataResult {
  const loadControlRef = useRef<{ inFlight: boolean; lastKey: string | null }>({
    inFlight: false,
    lastKey: null,
  });

  const resolveError = useApiError();

  const loadData = useCallback(
    async (force = false) => {
      const loadKey = `${isPublicPage ? "public" : "private"}|${userId ?? "anon"}|${csrfToken ?? "nocsrf"}|${isDemo ? "demo" : "live"}`;

      // Prevent request storms from effect/dependency churn.
      if (!force) {
        if (loadControlRef.current.inFlight) {
          return;
        }
        if (loadControlRef.current.lastKey === loadKey) {
          return;
        }
      }

      loadControlRef.current.inFlight = true;
      loadControlRef.current.lastKey = loadKey;

      // Do not preload protected dashboard data on public routes (landing/auth/demo).
      if (isPublicPage) {
        dispatch({ type: "SET_LOADING", payload: false });
        loadControlRef.current.inFlight = false;
        return;
      }

      // Demo mode: load bundled demo data — no API calls, no auth needed
      if (isDemoModeClient()) {
        dispatch({ type: "SET_LOADING", payload: true });
        dispatch({ type: "SET_ERROR", payload: null });
        dispatch({ type: "SET_PROPERTIES", payload: getDemoData<Property>("properties") });
        dispatch({ type: "SET_BUILDINGS", payload: getDemoData<Building>("buildings") });
        dispatch({ type: "SET_TENANTS", payload: getDemoData<Tenant>("tenants") });
        dispatch({ type: "SET_RECEIPTS", payload: getDemoData<Receipt>("receipts") });
        dispatch({
          type: "SET_TEMPLATES",
          payload: getDemoData<CorrespondenceTemplate>("templates"),
        });
        dispatch({
          type: "SET_CORRESPONDENCE",
          payload: getDemoData<Correspondence>("correspondence"),
        });
        dispatch({ type: "SET_OWNERS", payload: getDemoData<Owner>("owners") });
        dispatch({ type: "SET_EXPENSES", payload: getDemoData<Expense>("expenses") });
        dispatch({
          type: "SET_MAINTENANCE",
          payload: getDemoData<MaintenanceTicket>("maintenance"),
        });
        dispatch({ type: "SET_LEASES", payload: getDemoData<Lease>("leases") });
        dispatch({ type: "SET_LOADING", payload: false });
        loadControlRef.current.inFlight = false;
        return;
      }

      // Prevent API calls if not authenticated
      if (!userId) {
        dispatch({ type: "SET_LOADING", payload: false });
        loadControlRef.current.inFlight = false;
        return;
      }
      try {
        dispatch({ type: "SET_LOADING", payload: true });
        dispatch({ type: "SET_ERROR", payload: null });

        const [
          propertiesRes,
          buildingsRes,
          tenantsRes,
          receiptsRes,
          templatesRes,
          correspondenceRes,
          ownersRes,
          expensesRes,
          maintenanceRes,
          leasesRes,
        ] = await Promise.all([
          apiFetch<{ data: Property[] }>("/api/properties", csrfToken),
          apiFetch<{ data: Building[] }>("/api/buildings", csrfToken),
          apiFetch<{ data: Tenant[] }>("/api/tenants", csrfToken),
          apiFetch<{ data: Receipt[] }>("/api/receipts", csrfToken),
          apiFetch<{ data: CorrespondenceTemplate[] }>("/api/correspondence/templates", csrfToken),
          apiFetch<{ data: Correspondence[] }>("/api/correspondence", csrfToken),
          apiFetch<{ data: Owner[] }>("/api/owners", csrfToken),
          apiFetch<{ data: Expense[] }>("/api/expenses", csrfToken),
          apiFetch<{ data: MaintenanceTicket[] }>("/api/maintenance", csrfToken),
          apiFetch<{ data: Lease[] }>("/api/leases", csrfToken),
        ]);

        dispatch({
          type: "SET_PROPERTIES",
          payload: (propertiesRes.data ?? propertiesRes) as Property[],
        });
        dispatch({
          type: "SET_BUILDINGS",
          payload: (buildingsRes.data ?? buildingsRes) as Building[],
        });
        dispatch({
          type: "SET_TENANTS",
          payload: (tenantsRes.data ?? tenantsRes) as Tenant[],
        });
        dispatch({
          type: "SET_RECEIPTS",
          payload: (receiptsRes.data ?? receiptsRes) as Receipt[],
        });
        dispatch({
          type: "SET_TEMPLATES",
          payload: (templatesRes.data ?? templatesRes) as CorrespondenceTemplate[],
        });
        dispatch({
          type: "SET_CORRESPONDENCE",
          payload: (correspondenceRes.data ?? correspondenceRes) as Correspondence[],
        });
        dispatch({
          type: "SET_OWNERS",
          payload: (ownersRes.data ?? ownersRes) as Owner[],
        });
        dispatch({
          type: "SET_EXPENSES",
          payload: (expensesRes.data ?? expensesRes) as Expense[],
        });
        dispatch({
          type: "SET_MAINTENANCE",
          payload: (maintenanceRes.data ?? maintenanceRes) as MaintenanceTicket[],
        });
        dispatch({
          type: "SET_LEASES",
          payload: (leasesRes.data ?? leasesRes) as Lease[],
        });
      } catch (err) {
        const errorMessage = resolveError(err);

        // Check if this is a CSRF error
        const isCsrfError =
          (err instanceof Error &&
            (err.message.includes("CSRF") || err.message.includes("csrf"))) ||
          (typeof err === "object" &&
            err !== null &&
            "status" in err &&
            (err as { status?: number }).status === 403);

        // For CSRF errors, suggest refresh
        const displayMessage = isCsrfError
          ? "Security token expired. Please refresh the page."
          : errorMessage;

        dispatch({ type: "SET_ERROR", payload: displayMessage });
        showError(displayMessage);
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
        loadControlRef.current.inFlight = false;
      }
    },
    [userId, csrfToken, showError, isPublicPage, isDemo, dispatch, resolveError],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const refreshData = useCallback(() => loadData(true), [loadData]);

  return { refreshData };
}
