"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils/api-client";
import { useCsrf } from "@/lib/contexts/csrf-context";

/** A row of `GET /api/bank/connections`. */
export interface BankConnectionRow {
  id: string;
  provider: string;
  institutionName: string;
  status: string;
  lastSyncAt: string | null;
  consentExpiresAt: string | null;
  isProvider: boolean;
  canSync: boolean;
  remainingBudget: number | null;
}

/**
 * The instance's bank connections, for Settings › Integrations and the Finance inbox. A failed
 * read leaves the list empty: both screens are status views, and each says what an empty list
 * means.
 */
export function useBankConnections() {
  const [connections, setConnections] = useState<BankConnectionRow[]>([]);
  const [providersConfigured, setProvidersConfigured] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped after a connect or a sync so the list reflects what just happened.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await apiFetch<{
          connections?: BankConnectionRow[];
          providersConfigured?: string[];
        }>("/api/bank/connections");
        if (cancelled) return;
        setConnections(body?.connections ?? []);
        setProvidersConfigured(body?.providersConfigured ?? []);
      } catch {
        // Best-effort status view: leave it empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { connections, providersConfigured, loading, reload };
}

/**
 * What a sync brought, or which of its three problems stopped it. Only the new movements are
 * counted: the import's own "needs review" includes money going out, which is never work.
 */
export type BankSyncOutcome =
  { ok: true; imported: number } | { ok: false; problem: "budget" | "consent" | "failed" };

/**
 * The message key, under `settings.panel`, for each problem. The budget and the expired consent
 * have different remedies, so they must not collapse into one "try again" that is wrong for both.
 */
export const BANK_SYNC_PROBLEM_KEY = {
  budget: "bankSyncBudgetSpent",
  consent: "bankSyncConsentExpired",
  failed: "bankSyncFailed",
} as const;

/** Sync one connection now: `POST /api/bank/connections/[id]/sync`. */
export function useBankSync(): (connectionId: string) => Promise<BankSyncOutcome> {
  const { token: csrfToken } = useCsrf();
  return useCallback(
    async (connectionId: string): Promise<BankSyncOutcome> => {
      try {
        const result = await apiFetch<{ summaries?: { imported?: number }[] }>(
          `/api/bank/connections/${connectionId}/sync`,
          csrfToken,
          "POST",
          {},
        );
        const summaries = result?.summaries ?? [];
        return { ok: true, imported: summaries.reduce((n, s) => n + (s.imported ?? 0), 0) };
      } catch (err) {
        const status = (err as { status?: number })?.status;
        return {
          ok: false,
          problem: status === 429 ? "budget" : status === 409 ? "consent" : "failed",
        };
      }
    },
    [csrfToken],
  );
}
