import { useMemo, useSyncExternalStore } from "react";
import { vi } from "vitest";
import type { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * An address for components that read `useSearchParams` and write with `router.replace`, where a
 * replace lands only when the test calls `flush()`.
 *
 * Next's router writes a replace after the render that asked for it. Code that compares the
 * address with its own state in between is where a tab snaps back, and the global mock in
 * `tests/setup.ts` can't show it: its `replace` does nothing and its search params never change.
 *
 * Install it with `vi.mocked(...)` on the three `next/navigation` hooks the setup file mocks.
 */
export function createFakeAddress(pathname: string, search = "") {
  let current = search;
  let pending: string | null = null;
  const listeners = new Set<() => void>();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const commit = (next: string) => {
    current = next;
    listeners.forEach((listener) => listener());
  };

  const router = {
    push: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn((url: string) => {
      const at = url.indexOf("?");
      pending = at === -1 ? "" : url.slice(at + 1);
    }),
  };

  function useFakeSearchParams() {
    const value = useSyncExternalStore(
      subscribe,
      () => current,
      () => current,
    );
    return useMemo(() => new URLSearchParams(value), [value]);
  }

  return {
    router: router as unknown as ReturnType<typeof useRouter>,
    replace: router.replace,
    pathname,
    useSearchParams: useFakeSearchParams as unknown as typeof useSearchParams,
    usePathname: (() => pathname) as typeof usePathname,
    /** The query string the page shows now, without the `?`. */
    get search() {
      return current;
    },
    /** Lands the last replace, as the router eventually does. Call it inside `act`. */
    flush() {
      if (pending === null) return;
      const next = pending;
      pending = null;
      commit(next);
    },
    /** Moves the address the way back and forward do. Call it inside `act`. */
    navigate(next: string) {
      commit(next);
    },
  };
}
