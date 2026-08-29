/**
 * Generic CRUD action factory for entity context operations.
 *
 * Eliminates the ~500 LOC of near-identical add/update/delete boilerplate in
 * AppContext by generating typed CRUD functions for any entity with { id: string }.
 */

import { apiFetch } from "@/lib/utils/api-client";

export interface EntityActions<T extends { id: string }> {
  add: (data: Partial<T>) => Promise<T>;
  update: (id: string, data: Partial<T>) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

interface EntityActionConfig<T extends { id: string }> {
  /**
   * Turns a caught error into a sentence in the user's language.
   *
   * Passed in rather than resolved here: this is a factory, not a component, so it cannot call
   * `useApiError` itself. `use-entity-actions.ts` is a hook and resolves it there, the same way
   * `csrfToken` and `showError` already arrive from above. Before this, all three verbs showed
   * the server's English `err.message` in a toast.
   */
  resolveError: (err: unknown) => string;
  /** API base path, e.g. "/api/properties" */
  endpoint: string;
  /** Current items in state */
  getItems: () => T[];
  /** Dispatch updated list to state */
  setItems: (items: T[]) => void;
  /** Show error toast */
  showError: (msg: string) => void;
  /** Show success toast */
  showSuccess?: (msg: string) => void;
  /** CSRF token */
  csrfToken: string | null;
  /** Human-readable entity name for error messages */
  entityName: string;
  /** Whether to require userId check (default: true) */
  requireAuth?: boolean;
  /** Current userId for auth check */
  userId?: string | null;
  /** Whether to prepend new items (default: false = append) */
  prependNew?: boolean;
  /** Whether in demo mode — appends qualifier to success messages */
  isDemo?: boolean;
}

/**
 * Creates add / update / delete functions for an entity, wired to the correct
 * API endpoint and state dispatcher.  Each generated function mirrors the
 * pattern used in the original hand-written AppContext methods:
 *
 * - add:    POST → append/prepend to state
 * - update: PUT  → replace in state
 * - delete: optimistic removal → rollback on failure
 */
export function createEntityActions<T extends { id: string }>(
  config: EntityActionConfig<T>,
): EntityActions<T> {
  const {
    endpoint,
    getItems,
    setItems,
    showError,
    showSuccess,
    csrfToken,
    entityName,
    requireAuth = true,
    userId,
    prependNew = false,
    isDemo = false,
    resolveError,
  } = config;

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const demoSuffix = isDemo ? " (demo mode)" : "";

  const add = async (data: Partial<T>): Promise<T> => {
    if (requireAuth && !userId) throw new Error("User not authenticated");
    try {
      const res = await apiFetch<T | { data: T }>(endpoint, csrfToken, "POST", data);
      const created = (res as { data: T }).data ?? (res as T);
      setItems(prependNew ? [created, ...getItems()] : [...getItems(), created]);
      showSuccess?.(`${capitalize(entityName)} added successfully${demoSuffix}`);
      return created;
    } catch (err) {
      const msg = resolveError(err);
      showError(msg);
      throw err;
    }
  };

  const update = async (id: string, data: Partial<T>): Promise<T> => {
    if (requireAuth && !userId) throw new Error("User not authenticated");
    try {
      const res = await apiFetch<T | { data: T }>(`${endpoint}/${id}`, csrfToken, "PUT", data);
      const updated = (res as { data: T }).data ?? (res as T);
      setItems(getItems().map((item) => (item.id === id ? updated : item)));
      showSuccess?.(`${capitalize(entityName)} updated successfully${demoSuffix}`);
      return updated;
    } catch (err) {
      const msg = resolveError(err);
      showError(msg);
      throw err;
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (requireAuth && !userId) throw new Error("User not authenticated");
    const previous = getItems();
    // Optimistic delete
    setItems(previous.filter((item) => item.id !== id));
    try {
      await apiFetch(`${endpoint}/${id}`, csrfToken, "DELETE");
      showSuccess?.(`${capitalize(entityName)} deleted successfully${demoSuffix}`);
    } catch (err) {
      // Rollback on failure
      setItems(previous);
      const msg = resolveError(err);
      showError(msg);
      throw err;
    }
  };

  return { add, update, remove };
}
