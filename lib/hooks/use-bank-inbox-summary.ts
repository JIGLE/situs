"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils/api-client";
import type { BankInboxSummary } from "@/lib/utils/bank-inbox";

/**
 * The bank inbox's counts, for the Finance tab badge and the dashboard. Null until they arrive,
 * and after a failed read: a missing badge is honest, a zero would claim there is nothing to do.
 */
export function useBankInboxSummary() {
  const [summary, setSummary] = useState<BankInboxSummary | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<BankInboxSummary>("/api/bank/transactions/summary")
      .then((body) => {
        if (!cancelled) setSummary(body ?? null);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { summary, refresh };
}
