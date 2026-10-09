"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { BLEND } from "@/components/blend/tokens";
import { useBlendGround } from "@/components/blend/useBlendGround";
import { buildCountyRows, type CountyRow } from "./countyModel";
import { cachedCounties, countyKey, loadCounties } from "./countyStore";
import { COUNTY_OFFSET_Y } from "./usStatesGeo";

/** Zoom at which counties start to fade in over their states. */
export const COUNTY_ZOOM = 3.2;
/** Zoom at which the county layer is fully opaque. */
export const COUNTY_ZOOM_FULL = 4.2;

/** Opacity of the county layer at zoom `k`: 0 below the threshold, ramping to 1. */
export function countyOpacity(k: number): number {
  if (k <= COUNTY_ZOOM) return 0;
  if (k >= COUNTY_ZOOM_FULL) return 1;
  return (k - COUNTY_ZOOM) / (COUNTY_ZOOM_FULL - COUNTY_ZOOM);
}

/**
 * County rows for every state in `stateIds`, fetched as those states come into
 * view. States already loaded stay loaded when they scroll out, so panning back
 * does not flash. A state with no county results is simply absent.
 */
export function useCountyRows(
  electionId: string,
  turn: number | null,
  stateIds: string[],
  candidate: (id: string) => { name: string; color: string }
): Record<string, CountyRow[]> {
  // Bumped whenever a request lands, so the memo below re-reads the cache.
  const [loaded, setLoaded] = useState(0);
  const ground = useBlendGround();
  const idsKey = stateIds.join(",");

  useEffect(() => {
    if (!idsKey) return;
    let live = true;
    for (const id of idsKey.split(",")) {
      if (cachedCounties(countyKey(electionId, id, turn))) continue;
      loadCounties(electionId, id, turn).then((data) => {
        if (live && data) setLoaded((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [electionId, turn, idsKey]);

  // Every state requested so far, in first-seen order. Grown during render
  // rather than in an effect, so a newly visible state is included in the
  // same pass that asked for it.
  const [seen, setSeen] = useState<string[]>([]);
  const unseen = stateIds.filter((id) => !seen.includes(id));
  if (unseen.length > 0) setSeen([...seen, ...unseen]);

  return useMemo(() => {
    void loaded;
    const out: Record<string, CountyRow[]> = {};
    for (const id of seen) {
      const data = cachedCounties(countyKey(electionId, id, turn));
      if (data) out[id] = buildCountyRows(data, candidate, ground);
    }
    return out;
  }, [seen, loaded, electionId, turn, candidate, ground]);
}

/**
 * County shapes for the loaded states, shifted into the national map's frame.
 * Pointer handling is delegated to the svg through `data-state` and
 * `data-county`, exactly as the state shapes do.
 */
export const CountyPaths = memo(function CountyPaths({
  rows,
  opacity,
}: {
  rows: Record<string, CountyRow[]>;
  opacity: number;
}) {
  if (opacity <= 0) return null;
  return (
    <g transform={`translate(0 ${COUNTY_OFFSET_Y})`} opacity={opacity}>
      {Object.entries(rows).map(([stateId, list]) => (
        <g key={stateId}>
          {list.map((row) => (
            <path
              key={row.id}
              d={row.path}

              strokeOpacity={0.55}
              strokeWidth={0.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              data-state={stateId}
              data-county={row.id}
              style={{ fill: row.fill, stroke: BLEND.page, cursor: "pointer" }}
            />
          ))}
        </g>
      ))}
    </g>
  );
});
