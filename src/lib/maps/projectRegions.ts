import type { GeoFeature } from "@/components/maps/RegionalGeoMap";
import type { FrontBox, PxPoint, PxRing } from "./frontLine";

/**
 * Region geometry projected into a fixed px box, so a front line can be derived
 * and drawn in one flat coordinate space.
 *
 * `RegionalGeoMap` hands its geometry to react-simple-maps, which projects at
 * draw time — fine for colouring whole regions, useless for a line that has to
 * cut ACROSS them. The Mercator fit here is the same one `computeFitProjection`
 * gives react-simple-maps (centre + scale, translate at the box centre), so a
 * front map frames its host identically to every other map of that country.
 *
 * Pure, and deliberately dependency-free: d3-geo is untyped in this repo, and the
 * three formulas involved are already hand-rolled in `RegionalGeoMap`.
 */

export interface ProjectedRegion {
  /** The region code — the label drawn on the map. */
  id: string;
  /** The region's own name, or its code when the shard carries no name. */
  name: string;
  /** SVG path in px space. */
  d: string;
  /** Label anchor: the area-weighted centroid of the region's largest ring. */
  cx: number;
  cy: number;
  /** Projected area in px², a relative weight for ordering and label filtering. */
  area: number;
}

export interface ProjectedGeometry {
  box: FrontBox;
  regions: ProjectedRegion[];
  /** Every projected ring, holes included — the input to `sampleLand`. */
  rings: PxRing[];
  /** Project a lon/lat point (e.g. a country anchor) into the same px space. */
  project: (lonLat: PxPoint) => PxPoint;
}

/** Inset from the box edge, matching `RegionalGeoMap`'s fit. */
const PAD = 12;
const D2R = Math.PI / 180;
/** Mercator diverges at the poles; clamp before the log, as web Mercator does. */
const MAX_LAT = 85.05;

const mercY = (latDeg: number): number =>
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, latDeg)) * D2R) / 2));

/**
 * A feature's polygons, each as [outer, ...holes].
 *
 * The structure is KEPT rather than flattened to a ring list: per GeoJSON a
 * polygon's first ring is its exterior and the rest are holes, which is the only
 * winding-independent way to tell them apart. Shard winding is not something to
 * bet an area on — the build pipeline flips it (mapshaper emits CCW outers, the
 * shards are re-wound CW for d3), so a signed-sum would silently double-count a
 * mis-wound hole instead of subtracting it.
 */
function polygonsOf(f: GeoFeature): number[][][][] {
  const g = f.geometry;
  if (g?.type === "Polygon") return [(g.coordinates as number[][][]) ?? []];
  if (g?.type === "MultiPolygon") return (g.coordinates as number[][][][]) ?? [];
  return [];
}

/** Shoelace signed area of a px ring (positive for one winding, negative the other). */
function signedArea(ring: PxRing): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** Area-weighted centroid of a px ring, or null when the ring is degenerate. */
function centroidOf(ring: PxRing): PxPoint | null {
  const area = signedArea(ring);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-9) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  const k = 1 / (6 * area);
  return [cx * k, cy * k];
}

/**
 * Fit `features` into `box` and project them.
 *
 * Returns null when nothing drawable was supplied — a host with no manifest
 * geometry, which the caller degrades to a meter rather than an empty frame.
 */
export function projectRegions(features: GeoFeature[], box: FrontBox): ProjectedGeometry | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const f of features) {
    for (const poly of polygonsOf(f)) {
      for (const ring of poly) {
        for (const p of ring) {
          const [lon, lat] = p;
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }
  if (minLon === Infinity) return null;

  const lonSpan = Math.max((maxLon - minLon) * D2R, 1e-6);
  const latSpan = Math.max(mercY(maxLat) - mercY(minLat), 1e-6);
  const scale = Math.min((box.w - 2 * PAD) / lonSpan, (box.h - 2 * PAD) / latSpan);
  const cLon = (minLon + maxLon) / 2;
  const cMercY = (mercY(minLat) + mercY(maxLat)) / 2;

  const project = (lonLat: PxPoint): PxPoint => [
    (lonLat[0] - cLon) * D2R * scale + box.w / 2,
    (cMercY - mercY(lonLat[1])) * scale + box.h / 2,
  ];

  const rings: PxRing[] = [];
  const regions: ProjectedRegion[] = [];
  for (const f of features) {
    const id = f.properties?.regionCode;
    if (!id) continue;
    // A ring needs 4 positions to close; a shorter one is a broken shard artifact
    // (see `dropDegenerateRings`) and would emit a path d3 cannot stream either.
    // A polygon whose EXTERIOR is degenerate is dropped whole — its holes have
    // nothing left to punch through.
    const projected = polygonsOf(f)
      .map((poly) =>
        poly
          .filter((r) => Array.isArray(r) && r.length >= 4)
          .map((r) => r.map((p) => project([p[0], p[1]])))
      )
      .filter((poly) => poly.length > 0);
    if (projected.length === 0) continue;
    const flat = projected.flat();
    rings.push(...flat);

    const d = projected
      .flat()
      .map((r) => `M${r.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L")}Z`)
      .join("");
    // Largest ring, not a flat vertex mean: a multi-part region (islands, a
    // peninsula) averages out to open water between its parts otherwise — the
    // same failure `RegionalGeoMap.featureCentroid` fixes for its labels.
    const largest = flat.reduce((a, b) =>
      Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a
    );
    const centroid = centroidOf(largest);
    if (!centroid) continue;
    // Exterior minus its holes, per polygon — a region's area is its land, not
    // its bounding shape (Brandenburg carries Berlin as an enclave).
    const area = projected.reduce(
      (sum, [outer, ...holes]) =>
        sum +
        Math.abs(signedArea(outer)) -
        holes.reduce((h, ring) => h + Math.abs(signedArea(ring)), 0),
      0
    );

    regions.push({
      id,
      name: f.properties?.na ?? id,
      d,
      cx: centroid[0],
      cy: centroid[1],
      area: Math.max(0, area),
    });
  }

  if (regions.length === 0) return null;
  return { box, regions, rings, project };
}
