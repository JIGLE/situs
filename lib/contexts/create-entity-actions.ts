/**
 * Generic CRUD action factory for entity context operations.
 *
 * Eliminates the ~500 LOC of near-identical add/update/delete boilerplate in
 * AppContext by generating typed CRUD functions for any entity with { id: string }.
 */

import { apiFetch } from "@/lib/utils/api-client";
import { markReported } from "@/lib/utils/api-error";

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
  /**
   * Show error toast. Failures are the only thing this factory reports: a success belongs to the
   * form or screen that asked for it, which already says so in the user's language. The factory
   * used to add an English "Owner added successfully" on top of that.
   */
  showError: (msg: string) => void;
  /** CSRF token */
  csrfToken: string | null;
  /** Whether to require userId check (default: true) */
  requireAuth?: boolean;
  /** Current userId for auth check */
  userId?: string | null;
  /** Whether to prepend new items (default: false = append) */
  prependNew?: boolean;
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
    csrfToken,
    requireAuth = true,
    userId,
    prependNew = false,
    resolveError,
  } = config;

  // Inside each `try`, so a signed-out attempt is reported like any other failure rather than
  // rejecting with nothing on screen.
  const assertSignedIn = () => {
    if (requireAuth && !userId) throw new Error("User not authenticated");
  };

  const add = async (data: Partial<T>): Promise<T> => {
    try {
      assertSignedIn();
      const res = await apiFetch<T | { data: T }>(endpoint, csrfToken, "POST", data);
      const created = (res as { data: T }).data ?? (res as T);
      setItems(prependNew ? [created, ...getItems()] : [...getItems(), created]);
      return created;
    } catch (err) {
      const msg = resolveError(err);
      showError(msg);
      // Marked, so the caller's own `catch` knows the user has already been told.
      throw markReported(err);
    }
  };

  const update = async (id: string, data: Partial<T>): Promise<T> => {
    try {
      assertSignedIn();
      const res = await apiFetch<T | { data: T }>(`${endpoint}/${id}`, csrfToken, "PUT", data);
      const updated = (res as { data: T }).data ?? (res as T);
      setItems(getItems().map((item) => (item.id === id ? updated : item)));
      return updated;
    } catch (err) {
      const msg = resolveError(err);
      showError(msg);
      throw markReported(err);
    }
  };

  const remove = async (id: string): Promise<void> => {
    const previous = getItems();
    try {
      assertSignedIn();
      // Optimistic delete
      setItems(previous.filter((item) => item.id !== id));
      await apiFetch(`${endpoint}/${id}`, csrfToken, "DELETE");
    } catch (err) {
      // Rollback on failure
      setItems(previous);
      const msg = resolveError(err);
      showError(msg);
      throw markReported(err);
    }
  };

  return { add, update, remove };
}
