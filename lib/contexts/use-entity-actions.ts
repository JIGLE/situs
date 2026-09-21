/**
 * Per-entity CRUD action bundle for AppProvider.
 *
 * Each entity gets its own memoized add/update/remove group via the shared
 * createEntityActions factory. Extracted from app-context.tsx so the provider
 * stays a thin composition layer; the public action surface is unchanged.
 */

import { useMemo } from "react";
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
  Lease,
} from "@/lib/types";
import { createEntityActions, type EntityActions } from "./create-entity-actions";
import { useApiError } from "@/lib/utils/api-error";
import type { AppAction, AppState } from "./app-reducer";

interface EntityActionsContext {
  csrfToken: string | null;
  userId?: string;
  showError: (msg: string) => void;
  showSuccess: (msg: string) => void;
}

export interface EntityActionsBundle {
  buildingActions: EntityActions<Building>;
  propertyActions: EntityActions<Property>;
  tenantActions: EntityActions<Tenant>;
  receiptActions: EntityActions<Receipt>;
  templateActions: EntityActions<CorrespondenceTemplate>;
  correspondenceActions: EntityActions<Correspondence>;
  ownerActions: EntityActions<Owner>;
  expenseActions: EntityActions<Expense>;
  leaseActions: EntityActions<Lease>;
}

export function useEntityActions(
  state: AppState,
  dispatch: React.Dispatch<AppAction>,
  ctx: EntityActionsContext,
): EntityActionsBundle {
  const { csrfToken, userId, showError, showSuccess } = ctx;
  const resolveError = useApiError();

  const propertyActions = useMemo(
    () =>
      createEntityActions<Property>({
        endpoint: "/api/properties",
        getItems: () => state.properties,
        setItems: (items) => dispatch({ type: "SET_PROPERTIES", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "property",
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.properties, dispatch],
  );

  const buildingActions = useMemo(
    () =>
      createEntityActions<Building>({
        endpoint: "/api/buildings",
        getItems: () => state.buildings,
        setItems: (items) => dispatch({ type: "SET_BUILDINGS", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "building",
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.buildings, dispatch],
  );

  const tenantActions = useMemo(
    () =>
      createEntityActions<Tenant>({
        endpoint: "/api/tenants",
        getItems: () => state.tenants,
        setItems: (items) => dispatch({ type: "SET_TENANTS", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "tenant",
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.tenants, dispatch],
  );

  const receiptActions = useMemo(
    () =>
      createEntityActions<Receipt>({
        endpoint: "/api/receipts",
        getItems: () => state.receipts,
        setItems: (items) => dispatch({ type: "SET_RECEIPTS", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "receipt",
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.receipts, dispatch],
  );

  const templateActions = useMemo(
    () =>
      createEntityActions<CorrespondenceTemplate>({
        endpoint: "/api/correspondence/templates",
        getItems: () => state.templates,
        setItems: (items) => dispatch({ type: "SET_TEMPLATES", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "template",
        requireAuth: false,
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.templates, dispatch],
  );

  const correspondenceActions = useMemo(
    () =>
      createEntityActions<Correspondence>({
        endpoint: "/api/correspondence",
        getItems: () => state.correspondence,
        setItems: (items) => dispatch({ type: "SET_CORRESPONDENCE", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "correspondence",
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.correspondence, dispatch],
  );

  const ownerActions = useMemo(
    () =>
      createEntityActions<Owner>({
        endpoint: "/api/owners",
        getItems: () => state.owners,
        setItems: (items) => dispatch({ type: "SET_OWNERS", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "owner",
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.owners, dispatch],
  );

  const expenseActions = useMemo(
    () =>
      createEntityActions<Expense>({
        endpoint: "/api/expenses",
        getItems: () => state.expenses,
        setItems: (items) => dispatch({ type: "SET_EXPENSES", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "expense",
        prependNew: true,
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.expenses, dispatch],
  );

  const leaseActions = useMemo(
    () =>
      createEntityActions<Lease>({
        endpoint: "/api/leases",
        getItems: () => state.leases,
        setItems: (items) => dispatch({ type: "SET_LEASES", payload: items }),
        showError,
        resolveError,
        showSuccess,
        csrfToken,
        userId,
        entityName: "lease",
        prependNew: true,
      }),
    [csrfToken, userId, showError, resolveError, showSuccess, state.leases, dispatch],
  );

  return {
    buildingActions,
    propertyActions,
    tenantActions,
    receiptActions,
    templateActions,
    correspondenceActions,
    ownerActions,
    expenseActions,
    leaseActions,
  };
}
