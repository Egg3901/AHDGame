"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrgViewerInfo, OrgWorldResponse } from "./orgTypes";

/** Fetch the world-org view + the viewer's role; expose a refresh callback. */
export function useWorldView() {
  const [data, setData] = useState<OrgWorldResponse | null>(null);
  const [viewer, setViewer] = useState<OrgViewerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [worldRes, meRes] = await Promise.all([
        fetch("/api/world/international-organizations"),
        fetch("/api/world/international-organizations/me"),
      ]);
      const world = (await worldRes.json()) as OrgWorldResponse;
      setData(world);
      if (meRes.ok) setViewer((await meRes.json()) as OrgViewerInfo);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, viewer, loading, refresh };
}
