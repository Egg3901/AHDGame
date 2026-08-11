"use client";

import { useEffect, useState } from "react";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { HeadroomInfo } from "@/components/extraction/types";

/**
 * Live 75%-cap headroom for a (state, resource) via
 * GET /api/contracts/extraction/headroom?stateId=&resource=&countryId=.
 * Refetch by bumping `refreshKey`.
 */
export function useExtractionHeadroom(
  stateId: string | null,
  resource: ExtractableResource | null,
  countryId: string | null,
  refreshKey = 0
) {
  const [headroom, setHeadroom] = useState<HeadroomInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stateId || !resource || !countryId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const params = new URLSearchParams({
        stateId: stateId as string,
        resource: resource as string,
        countryId: countryId as string,
      });
      try {
        const data = await fetchJson<HeadroomInfo>(
          `/api/contracts/extraction/headroom?${params.toString()}`,
          { feature: "extraction:headroom" }
        );
        if (!cancelled) setHeadroom(data);
      } catch {
        if (!cancelled) setHeadroom(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [stateId, resource, countryId, refreshKey]);

  return { headroom: stateId && resource && countryId ? headroom : null, loading };
}
