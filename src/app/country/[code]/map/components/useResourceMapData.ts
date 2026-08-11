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
  const [resourceData, setResourceData] = useState<Record<string, ResourceEntry>>({});

  useEffect(() => {
    if (mode !== "resources") return;
    fetch(`/api/map/resources?countryId=${countryId}&resource=${resourceType}`)
      .then((r) => (r.ok ? r.json() : { states: {} }))
      .then(({ states }: { states: Record<string, ResourceEntry> }) => setResourceData(states))
      .catch(() => setResourceData({}));
  }, [mode, resourceType, countryId]);

  return resourceData;
}
