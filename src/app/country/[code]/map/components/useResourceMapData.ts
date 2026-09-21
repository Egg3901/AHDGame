import { useState, useEffect } from "react";
import type { ExtractableResource } from "@/lib/constants/commodities";

export type ResourceEntry = {
  capacity: number;
  contractedPct: number;
  openAccessPct: number;
};

export function useResourceMapData(
  mode: string,
  countryId: string,
  resourceType: ExtractableResource
): Record<string, ResourceEntry> {
  const requestKey = `${countryId}:${resourceType}`;
  const [result, setResult] = useState<{ key: string; data: Record<string, ResourceEntry> }>({
    key: "",
    data: {},
  });

  useEffect(() => {
    if (mode !== "resources") return;
    const controller = new AbortController();
    fetch(`/api/map/resources?countryId=${countryId}&resource=${resourceType}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { states: {} }))
      .then(({ states }: { states: Record<string, ResourceEntry> }) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data: states ?? {} });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data: {} });
      });
    return () => controller.abort();
  }, [mode, resourceType, countryId, requestKey]);

  return result.key === requestKey ? result.data : {};
}
