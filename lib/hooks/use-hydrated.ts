import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server's HTML and during hydration, true once React has attached the page's
 * handlers. A form in the first byte (the sign-in page since PR #498) can be submitted before
 * then, and the browser's own submit ignores `onSubmit`: keep its submit button disabled until
 * this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
