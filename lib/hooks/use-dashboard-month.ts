"use client";

import { useEffect, useState } from "react";

import type { DashboardMonth } from "@/lib/services/dashboard/month";
import { apiFetch } from "@/lib/utils/api-client";

/**
 * The dashboard's month, from `GET /api/dashboard/month`. Changing the month keeps the last
 * answer on screen until the new one arrives, so the page does not flash empty between months.
 */
export function useDashboardMonth(year: number, month: number) {
  const [data, setData] = useState<DashboardMonth | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<DashboardMonth>(`/api/dashboard/month?year=${year}&month=${month}`)
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  return { data, error };
}
