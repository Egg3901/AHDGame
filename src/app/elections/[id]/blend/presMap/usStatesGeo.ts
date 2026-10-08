import { CDN_GEO } from "@/lib/images/cdnUrls";
import { FIPS_TO_STATE } from "./usStates";

/** One state, already projected into the map's 960 x 600 coordinate space. */
export interface StateGeo {
  id: string;
  /** SVG path data. */
  d: string;
  /** Label anchor in map units. */
  centroid: [number, number];
  /** Bounding box width and height in map units, used to decide label fit. */
  width: number;
  height: number;
}

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 600;

/** Same TopoJSON the other US maps read, with the bundled copy as the fallback. */
const LOCAL_URL = "/us-states-10m.json";

async function fetchTopology(): Promise<unknown> {
  for (const url of [CDN_GEO.usStates, LOCAL_URL]) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // try the next source
    }
  }
  throw new Error("US state geometry could not be loaded");
}

let cached: Promise<StateGeo[]> | null = null;

/**
 * Load and project the state outlines once per page. Projection and path
 * generation are the expensive part, so the result is shared by every mount and
 * a failed load is not cached.
 */
export function loadUsStateGeo(): Promise<StateGeo[]> {
  if (cached) return cached;
  cached = (async () => {
    const [topology, topojson, d3] = await Promise.all([
      fetchTopology(),
      import("topojson-client"),
      import("d3-geo"),
    ]);
    const topo = topology as Parameters<typeof topojson.feature>[0] & {
      objects: { states: Parameters<typeof topojson.feature>[1] };
    };
    const collection = topojson.feature(topo, topo.objects.states) as unknown as {
      features: { id?: string | number }[];
    };
    const projection = d3
      .geoAlbersUsa()
      .scale(1070)
      .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
    const path = d3.geoPath(projection);
    const out: StateGeo[] = [];
    for (const feature of collection.features) {
      const id = FIPS_TO_STATE[String(feature.id ?? "").padStart(2, "0")];
      if (!id) continue;
      const geo = feature as unknown as Parameters<typeof path>[0];
      const d = path(geo);
      if (!d) continue;
      const [[x0, y0], [x1, y1]] = path.bounds(geo);
      const c = path.centroid(geo);
      out.push({
        id,
        d,
        centroid: [
          Number.isFinite(c[0]) ? c[0] : (x0 + x1) / 2,
          Number.isFinite(c[1]) ? c[1] : (y0 + y1) / 2,
        ],
        width: x1 - x0,
        height: y1 - y0,
      });
    }
    return out;
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
