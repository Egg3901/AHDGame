"use client";

import { useEffect, useState } from "react";
import { shardsForRegions } from "./regionManifest";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";

// Each shard's features are fetched at most once per session, keyed by URL.
const shardCache = new Map<string, Promise<GeoFeature[]>>();

function loadShard(url: string): Promise<GeoFeature[]> {
  let p = shardCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.json())
      .then((d) => (d?.features ?? []) as GeoFeature[])
      .catch(() => [] as GeoFeature[]);
    shardCache.set(url, p);
  }
  return p;
}

/**
 * Loads + merges the distinct geometry shards covering `codes` (resolved through
 * the manifest), so a nation map can render regions that span MORE THAN ONE shard
 * — e.g. France after acquiring German Länder (its FR_* regions have no geometry,
 * the Länder live in the germany shard). Shards are cached per URL. `features` is
 * null while loading; an empty array means none of the codes have manifest
 * geometry (render the list only).
 */
export function useRegionGeometry(codes: string[]): {
  features: GeoFeature[] | null;
  loading: boolean;
} {
  // Stable dependency: the sorted code set (codes arrays are rebuilt each render).
  const key = [...codes].sort().join(",");
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);

  useEffect(() => {
    const shards = shardsForRegions(key ? key.split(",") : []);
    let alive = true;
    // State is set only in the async resolution (no shards → Promise.all([]) → []),
    // so there's no synchronous setState in the effect body.
    Promise.all(shards.map((s) => loadShard(s.url))).then((lists) => {
      if (alive) setFeatures(lists.flat());
    });
    return () => {
      alive = false;
    };
  }, [key]);

  // `features === null` only before the first resolution — loading.
  return { features, loading: features === null };
}
