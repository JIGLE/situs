"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "situs-navigation-state";
const RECENT_ITEMS_KEY = "situs-recent-items";
const MAX_RECENT_ITEMS = 10;

interface NavigationState {
  activeTab: string;
  lastVisited: string;
  timestamp: number;
}

interface RecentItem {
  id: string;
  type: "property" | "tenant" | "lease" | "receipt";
  name: string;
  timestamp: number;
}

/**
 * Hook for persisting navigation state across sessions
 */
export function useNavigationPersistence(defaultTab = "overview") {
  const [activeTab, setActiveTabState] = useState(defaultTab);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load saved state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      // Check URL query param first
      const urlParams = new URLSearchParams(window.location.search);
      const tabFromUrl = urlParams.get("tab");

      if (tabFromUrl) {
        setActiveTabState(tabFromUrl);
        setIsInitialized(true);
        return;
      }

      // Fall back to localStorage
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state: NavigationState = JSON.parse(saved);
        // Only restore if saved within last 24 hours
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        if (state.timestamp > oneDayAgo) {
          setActiveTabState(state.activeTab);
        }
      }
    } catch (error) {
      console.error("Failed to load navigation state:", error);
    }

    setIsInitialized(true);
  }, []);

  // Custom setter that also persists
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);

    if (typeof window === "undefined") return;

    try {
      // Save to localStorage
      const state: NavigationState = {
        activeTab: tab,
        lastVisited: tab,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

      // Update URL without full navigation (optional - for shareable links)
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    } catch (error) {
      console.error("Failed to save navigation state:", error);
    }
  }, []);

  // Clear persisted state
  const clearState = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.removeItem(STORAGE_KEY);
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      window.history.replaceState({}, "", url.toString());
    } catch (error) {
      console.error("Failed to clear navigation state:", error);
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    clearState,
    isInitialized,
  };
}

/**
 * Hook for tracking recently visited items
 */
export function useRecentItems() {
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  // Load on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = localStorage.getItem(RECENT_ITEMS_KEY);
      if (saved) {
        const items: RecentItem[] = JSON.parse(saved);
        // Filter out items older than 7 days
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const filtered = items.filter((item) => item.timestamp > weekAgo);
        setRecentItems(filtered);
      }
    } catch (error) {
      console.error("Failed to load recent items:", error);
    }
  }, []);

  // Add item to recent list
  const addRecentItem = useCallback((item: Omit<RecentItem, "timestamp">) => {
    setRecentItems((prev) => {
      // Remove existing entry for same item
      const filtered = prev.filter((i) => !(i.id === item.id && i.type === item.type));

      // Add new entry at the beginning
      const newItems = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT_ITEMS);

      // Persist
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(newItems));
        } catch (error) {
          console.error("Failed to save recent items:", error);
        }
      }

      return newItems;
    });
  }, []);

  // Get recent items by type
  const getRecentByType = useCallback(
    (type: RecentItem["type"]) => {
      return recentItems.filter((item) => item.type === type);
    },
    [recentItems],
  );

  // Clear all recent items
  const clearRecent = useCallback(() => {
    setRecentItems([]);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(RECENT_ITEMS_KEY);
      } catch (error) {
        console.error("Failed to clear recent items:", error);
      }
    }
  }, []);

  return {
    recentItems,
    addRecentItem,
    getRecentByType,
    clearRecent,
  };
}

/**
 * Hook for managing favorites/pinned items
 */
const FAVORITES_KEY = "situs-favorites";

interface FavoriteItem {
  id: string;
  type: "property" | "tenant" | "lease" | "navigation";
  name: string;
  path?: string;
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  // Load on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      if (saved) {
        setFavorites(JSON.parse(saved));
      }
    } catch (error) {
      console.error("Failed to load favorites:", error);
    }
  }, []);

  // Add to favorites
  const addFavorite = useCallback((item: FavoriteItem) => {
    setFavorites((prev) => {
      // Check if already exists
      if (prev.some((f) => f.id === item.id && f.type === item.type)) {
        return prev;
      }

      const newFavorites = [...prev, item];

      // Persist
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
        } catch (error) {
          console.error("Failed to save favorites:", error);
        }
      }

      return newFavorites;
    });
  }, []);

  // Remove from favorites
  const removeFavorite = useCallback((id: string, type: FavoriteItem["type"]) => {
    setFavorites((prev) => {
      const newFavorites = prev.filter((f) => !(f.id === id && f.type === type));

      // Persist
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
        } catch (error) {
          console.error("Failed to save favorites:", error);
        }
      }

      return newFavorites;
    });
  }, []);

  // Toggle favorite
  const toggleFavorite = useCallback(
    (item: FavoriteItem) => {
      const exists = favorites.some((f) => f.id === item.id && f.type === item.type);
      if (exists) {
        removeFavorite(item.id, item.type);
      } else {
        addFavorite(item);
      }
    },
    [favorites, addFavorite, removeFavorite],
  );

  // Check if item is favorited
  const isFavorite = useCallback(
    (id: string, type: FavoriteItem["type"]) => {
      return favorites.some((f) => f.id === id && f.type === type);
    },
    [favorites],
  );

  // Get favorites by type
  const getFavoritesByType = useCallback(
    (type: FavoriteItem["type"]) => {
      return favorites.filter((f) => f.type === type);
    },
    [favorites],
  );

  return {
    favorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    getFavoritesByType,
  };
}
