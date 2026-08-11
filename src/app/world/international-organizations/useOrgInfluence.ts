"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";

/** Fetch an org's influence view; expose a refresh callback. Mirrors useWorldView. */
export function useOrgInfluence(orgId: string) {
  const [view, setView] = useState<OrgInfluenceView | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/world/international-organizations/${orgId}/influence`);
      if (!res.ok) return;
      setView((await res.json()) as OrgInfluenceView);
    } catch {
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { view, loading, refresh };
}
