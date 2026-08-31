"use client";

/**
 * Loading geometry for a conflict host that is NOT a full country.
 *
 * A proxy war is fought over entities the region-shard machinery cannot reach:
 * `useRegionGeometry` resolves shards by REGION CODE through the manifest, and
 * `regionCodesOfCountry` returns `[]` for North Vietnam because `states` holds only
 * full-autonomous countries. So the front maps get no features, no roster, and fall
 * back to the bare meter — for exactly the wars this whole subsystem is about.
 *
 * These hosts are drawn from the static feature files instead, the same ones the
 * world map claims through `mapFeatureIds`. WHICH shard covers a host is pure and
 * lives in `staticZoneGeometry`, because the server needs the same answer to decide
 * whether a conflict gets a map column at all.
 */
import { useEffect, useMemo, useState } from "react";
import type { GeoFeature } from "@/components/maps/RegionalGeoMap";
import { staticZoneGeometry } from "@/lib/maps/staticZoneGeometry";

// Re-exported so the existing importers (and their tests) keep one entry point
// for host geometry, while the server can reach the pure half directly.
export { staticHostGeometry, staticZoneGeometry } from "@/lib/maps/staticZoneGeometry";
export type { StaticHostGeometry } from "@/lib/maps/staticZoneGeometry";

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
 * Static features + the roster codes they need for a whole conflict zone, or empty
 * when every host in it is an ordinary country.
 *
 * Mirrors `useRegionGeometry`'s contract: `features` is null while loading so a
 * caller can tell "not yet" from "nothing to draw".
 *
 * Takes the FULL host roster rather than the anchor alone. Drawing only the anchor
 * left the other half of a two-host war off the map, and the front line is placed
 * as a share of the land it can see — so a line meant to sit on the border between
 * two hosts was measured against one of them and landed deep inside it.
 */
export function useStaticHostGeometry(hostEntityIds: readonly string[]): {
  features: GeoFeature[] | null;
  codes: string[];
} {
  // Joined rather than passed through: the caller almost always builds this array
  // inline, so a raw array in the dependency list re-fires the effect every render.
  const idKey = hostEntityIds.join(",");
  const { urls, codes } = useMemo(() => staticZoneGeometry(idKey ? idKey.split(",") : []), [idKey]);
  const urlKey = urls.join(",");
  const codeKey = codes.join(",");
  const [features, setFeatures] = useState<GeoFeature[] | null>(null);

  useEffect(() => {
    let alive = true;
    const wantedUrls = urlKey ? urlKey.split(",") : [];
    // Resolved through a promise even when there is no shard, so state is never set
    // synchronously in the effect body — the same shape `useRegionGeometry` uses,
    // and the reason it is written that way (cascading renders).
    const pending = wantedUrls.length
      ? Promise.all(wantedUrls.map(loadShard)).then((shards) => shards.flat())
      : Promise.resolve([] as GeoFeature[]);
    pending.then((all) => {
      if (!alive) return;
      // One shard carries every historical territory, so keep only this zone's. The
      // Set also dedupes: two hosts in one zone can claim the same feature (both
      // Vietnams resolve to the whole country), and drawing it twice would stack
      // two silhouettes and double-count the land the front line is placed against.
      const wanted = new Set(codeKey ? codeKey.split(",") : []);
      const seen = new Set<string>();
      setFeatures(
        all.filter((f) => {
          const code = String(f.properties?.regionCode ?? "");
          if (!wanted.has(code) || seen.has(code)) return false;
          seen.add(code);
          return true;
        })
      );
    });
    return () => {
      alive = false;
    };
  }, [urlKey, codeKey]);

  return {
    // A zone of ordinary countries has no static shard to wait for, so it resolves
    // to "nothing to add" IMMEDIATELY rather than reporting a load that will never
    // happen — otherwise every country map would sit at "plotting" until an
    // irrelevant fetch settled, and would depend on `fetch` existing at all.
    features: urlKey ? features : [],
    codes,
  };
}
