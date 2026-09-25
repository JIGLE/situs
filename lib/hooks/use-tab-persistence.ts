import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

/**
 * Hook for persisting tab state across page reloads
 * Stores state in both localStorage and URL query params
 *
 * @param moduleId - Unique identifier for the module (e.g., 'properties', 'financials')
 * @param defaultTab - Default tab to show if none is selected
 * @returns [activeTab, setActiveTab] tuple
 */
export function useTabPersistence(
  moduleId: string,
  defaultTab: string,
): [string, (tab: string) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hasHydratedFromStorage = useRef(false);

  // Get initial tab from URL or default only. Avoid reading localStorage during initial render
  // to prevent hydration mismatches between server and client. LocalStorage will be read
  // on the client after mount and will override the active tab if needed.
  const getInitialTab = useCallback(() => {
    const urlTab = searchParams.get("view");
    if (urlTab) return urlTab;
    return defaultTab;
  }, [searchParams, defaultTab]);

  const [activeTab, setActiveTabState] = useState<string>(getInitialTab);

  // Update both URL and localStorage when tab changes
  const setActiveTab = useCallback(
    (tab: string) => {
      if (tab === activeTab) {
        return;
      }

      setActiveTabState(tab);
      rememberTab(moduleId, tab);

      // Update URL without page reload
      const params = new URLSearchParams(searchParams.toString());
      const currentView = params.get("view");
      if (currentView !== tab) {
        params.set("view", tab);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    },
    [activeTab, moduleId, searchParams, router, pathname],
  );

  // On mount (client only) hydrate from localStorage if present (preference) or from URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasHydratedFromStorage.current) return;
    hasHydratedFromStorage.current = true;

    // Prefer URL param if present
    const urlTab = searchParams.get("view");
    if (urlTab && urlTab !== activeTab) {
      setActiveTabState(urlTab);
      return;
    }

    // Otherwise, try localStorage preference
    try {
      const stored = localStorage.getItem(`tab-${moduleId}`);
      if (stored && stored !== activeTab) {
        setActiveTabState(stored);
      }
    } catch {
      // ignore
    }
  }, [activeTab, moduleId, searchParams]);

  // Follow the address when `view` itself changes: browser back/forward, or a link that sets it.
  // Only a change of `view` counts. Comparing it with the tab on every render undid a click for as
  // long as the router took to write the new `view`, so the tab snapped back, then forward again.
  // Following does not store the tab: `view` is shared by every tabbed screen on the page (a
  // `?detail=` overlay opens over another page), so only a click here is this screen's choice.
  const urlTab = searchParams.get("view");
  useEffect(() => {
    if (urlTab) setActiveTabState(urlTab);
  }, [urlTab]);

  return [activeTab, setActiveTab];
}

function rememberTab(moduleId: string, tab: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`tab-${moduleId}`, tab);
  } catch {
    // ignore quota errors
  }
}
