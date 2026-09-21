/**
 * AppState shape, actions, and reducer for the global app context.
 *
 * Extracted from app-context.tsx so the provider file stays a thin composition
 * layer. The public AppState type is re-exported from app-context.tsx for
 * backward compatibility with existing consumers.
 */

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

export interface AppState {
  buildings: Building[];
  properties: Property[];
  tenants: Tenant[];
  receipts: Receipt[];
  templates: CorrespondenceTemplate[];
  correspondence: Correspondence[];
  owners: Owner[];
  expenses: Expense[];
  leases: Lease[];
  loading: boolean;
  error: string | null;
}

export type AppAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_BUILDINGS"; payload: Building[] }
  | { type: "SET_PROPERTIES"; payload: Property[] }
  | { type: "SET_TENANTS"; payload: Tenant[] }
  | { type: "SET_RECEIPTS"; payload: Receipt[] }
  | { type: "SET_TEMPLATES"; payload: CorrespondenceTemplate[] }
  | { type: "SET_CORRESPONDENCE"; payload: Correspondence[] }
  | { type: "SET_OWNERS"; payload: Owner[] }
  | { type: "SET_EXPENSES"; payload: Expense[] }
  | { type: "SET_LEASES"; payload: Lease[] };

export const initialState: AppState = {
  buildings: [],
  properties: [],
  tenants: [],
  receipts: [],
  templates: [],
  correspondence: [],
  owners: [],
  expenses: [],
  leases: [],
  loading: false,
  error: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_BUILDINGS":
      return { ...state, buildings: action.payload };
    case "SET_PROPERTIES":
      return { ...state, properties: action.payload };
    case "SET_TENANTS":
      return { ...state, tenants: action.payload };
    case "SET_RECEIPTS":
      return { ...state, receipts: action.payload };
    case "SET_TEMPLATES":
      return { ...state, templates: action.payload };
    case "SET_CORRESPONDENCE":
      return { ...state, correspondence: action.payload };
    case "SET_OWNERS":
      return { ...state, owners: action.payload };
    case "SET_EXPENSES":
      return { ...state, expenses: action.payload };
    case "SET_LEASES":
      return { ...state, leases: action.payload };
    default:
      return state;
  }
}
