"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Attention } from "@/lib/services/attention/rules";
import { apiFetch } from "@/lib/utils/api-client";

/**
 * What the owner still has to give Situs, from `GET /api/attention`. `reload` reads it again, and
 * keeps the last answer on screen meanwhile, so saving one field does not blank the screen.
 */
export function useAttention() {
  const [data, setData] = useState<Attention | null>(null);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const body = await apiFetch<Attention>("/api/attention");
      if (!mounted.current) return;
      setData(body);
      setError(null);
    } catch (err) {
      if (mounted.current) setError(err);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { data, error, reload };
}
