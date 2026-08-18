"use client";

import { useEffect, useState } from "react";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";
import { VIETNAM_FEATURE_IDS, VIETNAM_GEO_URL } from "@/lib/maps/vietnamGeometry";
import { HISTORICAL_FEATURE_IDS, HISTORICAL_GEO_URL } from "@/lib/maps/historicalGeometry";

/**
 * Geometry for a conflict host that is NOT a full country.
 *
 * A proxy war is fought over entities the region-shard machinery cannot reach:
 * `useRegionGeometry` resolves shards by REGION CODE through the manifest, and
 * `regionCodesOfCountry` returns `[]` for North Vietnam because `states` holds only
 * full-autonomous countries. So the front maps get no features, no roster, and fall
 * back to the bare meter — for exactly the wars this whole subsystem is about.
 *
 * These hosts are drawn from the static feature files instead, the same ones the
 * world map claims through `mapFeatureIds`.
 */
export interface StaticHostGeometry {
  url: string;
  /**
   * The roster codes this host contributes.
   *
   * ⚠️ Both consumers filter features against a roster — `RegionalGeoMap` builds a
   * Set from `regionCodes` and drops everything outside it, and `FrontLineMap`
   * filters inline. Supplying the features WITHOUT these codes renders an empty box
   * rather than a map, and every "features is non-empty" assertion still passes.
   */
  codes: string[];
}

/** The static shard covering this host, or null when nothing draws it. */
export function staticHostGeometry(hostEntityId: string): StaticHostGeometry | null {
  if ((VIETNAM_FEATURE_IDS as readonly string[]).includes(hostEntityId)) {
    // Both halves: a Vietnam proxy is the whole country split at the 17th
    // parallel, not a single successor state. Drawing only the host left a
    // half-outline and a west-east fallback axis because the other capital
    // sat off the map.
    return { url: VIETNAM_GEO_URL, codes: [...VIETNAM_FEATURE_IDS] };
  }
  if ((HISTORICAL_FEATURE_IDS as readonly string[]).includes(hostEntityId)) {
    return { url: HISTORICAL_GEO_URL, codes: [hostEntityId] };
  }
  return null;
}

const cache = new Map<string, Promise<GeoFeature[]>>();

function loadShard(url: string): Promise<GeoFeature[]> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((j: { features?: GeoFeature[] }) => j.features ?? [])
      .catch(() => [] as GeoFeature[]);
    cache.set(url, pending);
  }
  return pending;
}

/**
 * Static host features + the roster codes they need, or empty for an ordinary host.
 *
 * Mirrors `useRegionGeometry`'s contract: `features` is null while loading so a
 * caller can tell "not yet" from "nothing to draw".
 */
export function useStaticHostGeometry(hostEntityId: string): {
  features: GeoFeature[] | null;
  codes: string[];
} {
  const source = staticHostGeometry(hostEntityId);
  const url = source?.url ?? null;
  const codeKey = (source?.codes ?? []).join(",");
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);

  useEffect(() => {
    let alive = true;
    // Resolved through a promise even when there is no shard, so state is never set
    // synchronously in the effect body — the same shape `useRegionGeometry` uses,
    // and the reason it is written that way (cascading renders).
    const pending = url ? loadShard(url) : Promise.resolve([] as GeoFeature[]);
    pending.then((all) => {
      if (!alive) return;
      // One shard carries every historical territory, so keep only this host's.
      const wanted = new Set(codeKey ? codeKey.split(",") : []);
      setFeatures(all.filter((f) => wanted.has(String(f.properties?.regionCode ?? ""))));
    });
    return () => {
      alive = false;
    };
  }, [url, codeKey]);

  return {
    // An ordinary host has no static shard to wait for, so it resolves to "nothing
    // to add" IMMEDIATELY rather than reporting a load that will never happen —
    // otherwise every country map would sit at "plotting" until an irrelevant fetch
    // settled, and would depend on `fetch` existing at all.
    features: url ? features : [],
    codes: source?.codes ?? [],
  };
}
