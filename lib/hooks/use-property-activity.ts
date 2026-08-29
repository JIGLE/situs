"use client";

import { useEffect, useState } from "react";
import { httpError, useApiError } from "@/lib/utils/api-error";

export interface PropertyCurrentPeriod {
  year: number;
  month: number;
  status: string;
  dueAmount: number;
  allocatedAmount: number;
}

export interface PropertyTimelineEntry {
  id: string;
  amount: number;
  type: string;
  allocatedAt: string;
  reversedAt: string | null;
  createdBy: string;
  period: { year: number; month: number };
}

export interface PropertyYearStripCell {
  status: string;
  dueAmount: number;
  allocatedAmount: number;
}

export interface PropertyYearStrip {
  year: number;
  /** Keyed by month, 1-12. Absent months have no RentPeriod row yet (future/no lease). */
  months: Record<number, PropertyYearStripCell>;
}

export interface PropertyActivity {
  currentPeriod: PropertyCurrentPeriod | null;
  yearStrip: PropertyYearStrip;
  receiptLifecycle: string | null;
  timeline: PropertyTimelineEntry[];
}

/** Situs Current Period Status / year strip / PaymentTimeline — one fetch.
 * Pass `year` to refetch a specific year's strip (e.g. the year-strip's prev/next
 * nav); omit it for the API's own default (current year). The Audit tab reads
 * the shared AuditTrail component (GET /api/audit-trail) separately. */
export function usePropertyActivity(propertyId: string | undefined, year?: number) {
  const apiError = useApiError();
  const [data, setData] = useState<PropertyActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = year
      ? `/api/properties/${propertyId}/activity?year=${year}`
      : `/api/properties/${propertyId}/activity`;
    fetch(url, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw httpError(res.status);
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setData(body?.data ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(apiError(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, year, apiError]);

  return { data, loading, error };
}
