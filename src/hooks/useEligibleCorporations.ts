"use client";

import { useEffect, useState } from "react";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { EligibleCorporation } from "@/components/extraction/types";

/**
 * Extraction corporations with a sector in `stateId` for `resource`, via
 * GET /api/contracts/extraction/eligible-corporations?stateId=&resource=.
 * Powers the real corporation picker in the Issue Contract modal (never a raw
 * ObjectId input).
 */
export function useEligibleCorporations(
  stateId: string | null,
  resource: ExtractableResource | null
) {
  const [corporations, setCorporations] = useState<EligibleCorporation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!stateId || !resource) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const params = new URLSearchParams({
        stateId: stateId as string,
        resource: resource as string,
      });
      try {
        const data = await fetchJson<
          { corporations?: EligibleCorporation[] } | EligibleCorporation[]
        >(`/api/contracts/extraction/eligible-corporations?${params.toString()}`, {
          feature: "extraction:eligible-corporations",
        });
        if (cancelled) return;
        setCorporations(Array.isArray(data) ? data : (data.corporations ?? []));
      } catch {
        if (!cancelled) setCorporations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [stateId, resource]);

  return { corporations: stateId && resource ? corporations : [], loading };
}
