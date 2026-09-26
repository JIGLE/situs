"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { apiFetch } from "@/lib/utils/api-client";

/** The account's row from `GET /api/settings`, as far as the shell reads it. */
export interface AccountSettings {
  theme: string;
  language: string;
  /** Null until the owner chooses a language: the column's default is not a choice. */
  languageChosenAt: string | null;
  /** ISO 3166-1 alpha-2, default "PT". */
  residenceCountry: string;
}

interface UserSettingsContextValue {
  /** Null until loaded, when signed out, and for an account with no settings row yet. */
  settings: AccountSettings | null;
  /** Re-read the row, after a save made elsewhere (Settings). */
  refresh: () => Promise<void>;
  /** Apply a save this client made, without another round trip. */
  merge: (patch: Partial<AccountSettings>) => void;
}

const NOT_LOADED: UserSettingsContextValue = {
  settings: null,
  refresh: async () => {},
  merge: () => {},
};

const UserSettingsContext = createContext<UserSettingsContextValue>(NOT_LOADED);

/**
 * The signed-in owner's account settings, read once for the whole shell.
 *
 * The rail's line under the owner's name (their language and country of residence) and
 * `LanguageSync` both read the same row; each fetching it would be two requests for one row on
 * every page. Settings › Account calls `refresh` after saving the country, so the rail follows.
 */
export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [settings, setSettings] = useState<AccountSettings | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await apiFetch<AccountSettings | null>("/api/settings"));
    } catch {
      // Keep what was there: every reader has a default for a missing row.
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") void refresh();
  }, [status, refresh]);

  const merge = useCallback((patch: Partial<AccountSettings>) => {
    setSettings((previous) => (previous ? { ...previous, ...patch } : previous));
  }, []);

  const value = useMemo(() => ({ settings, refresh, merge }), [settings, refresh, merge]);
  return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>;
}

/** Outside the signed-in shell (the sign-in page) nothing is loaded, and `merge` does nothing. */
export function useUserSettings(): UserSettingsContextValue {
  return useContext(UserSettingsContext);
}
