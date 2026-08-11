"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { ProspectingSurveyRow } from "@/components/extraction/types";

interface UseProspectingSurveysArgs {
  stateId?: string | null;
  corporationId?: string | null;
  countryId?: string | null;
  /** Skip fetching (e.g. flag off). */
  enabled?: boolean;
}

/**
 * Fetches active + recent prospecting surveys for a scope via
 * GET /api/prospecting?stateId=&corporationId=&countryId=. Any combination of
 * the query params narrows the result, pass what you have.
 */
export function useProspectingSurveys({
  stateId,
  corporationId,
  countryId,
  enabled = true,
}: UseProspectingSurveysArgs) {
  const [surveys, setSurveys] = useState<ProspectingSurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const params = new URLSearchParams();
      if (stateId) params.set("stateId", stateId);
      if (corporationId) params.set("corporationId", corporationId);
      if (countryId) params.set("countryId", countryId);

      try {
        // The route returns { active, resolved } (resolved = last 50
        // succeeded/failed) rather than a flat list.
        const data = await fetchJson<{
          active?: ProspectingSurveyRow[];
          resolved?: ProspectingSurveyRow[];
        }>(`/api/prospecting?${params.toString()}`, { feature: "extraction:prospecting-surveys" });
        if (!cancelled) setSurveys([...(data.active ?? []), ...(data.resolved ?? [])]);
      } catch {
        if (!cancelled) setSurveys([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [stateId, corporationId, countryId, enabled, refreshKey]);

  return { surveys, loading: enabled ? loading : false, refresh };
}
