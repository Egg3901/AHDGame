import type { GeoFeature } from "@/components/maps/RegionalGeoMap";

/**
 * Which of a host country's regions an advance has taken.
 *
 * This is ONLY the ordering/selection logic — the geometry is loaded by
 * `useRegionGeometry` and drawn by `RegionalGeoMap`, the same pair every other
 * country map in the app uses. Nothing here fetches, projects or emits paths.
 *
 * The persisted state of a war is a single number (ConflictDoc.control); this turns
 * it into a SET OF REGION CODES, which `RegionalGeoMap` then colours.
 *
 * Spec: docs/superpowers/specs/2026-07-26-occupation-territory-design.md
 */

/** Outer rings of a feature, in lon/lat. Holes are irrelevant to area ordering. */
function outerRings(f: GeoFeature): number[][][] {
  const g = f.geometry;
  if (g?.type === "Polygon") return [(g.coordinates as number[][][])[0]];
  if (g?.type === "MultiPolygon") return (g.coordinates as number[][][][]).map((p) => p[0]);
  return [];
}

/** Shoelace area of a ring, sign-independent. */
function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/** A region's area in square degrees — a relative weight, not a true land area. */
export function featureArea(f: GeoFeature): number {
  return outerRings(f)
    .filter((r) => Array.isArray(r) && r.length >= 3)
    .reduce((sum, r) => sum + ringArea(r), 0);
}

/** A region's bounding-box centre — enough to sort by, and cheap. */
export function featureCentre(f: GeoFeature): [number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of outerRings(f)) {
    for (const point of ring) {
      const [lon, lat] = point;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (minLon === Infinity) return [0, 0];
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

const codeOf = (f: GeoFeature): string => f.properties?.regionCode ?? "";

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * The order regions fall in. With an anchor (the invader's side of the world) the
 * advance runs nearest-first. Without one it runs periphery-inward from the host's
 * own centre, so the heartland falls last. Ties break on region code, so the picture
 * is stable across renders. Does not mutate the input.
 */
export function orderFeatures(
  features: GeoFeature[],
  anchor: [number, number] | null
): GeoFeature[] {
  if (features.length === 0) return [];
  const centres = new Map(features.map((f) => [codeOf(f), featureCentre(f)]));

  let from: [number, number];
  if (anchor) {
    from = anchor;
  } else {
    let lon = 0;
    let lat = 0;
    for (const c of centres.values()) {
      lon += c[0];
      lat += c[1];
    }
    from = [lon / centres.size, lat / centres.size];
  }

  const sign = anchor ? 1 : -1; // no anchor → farthest-from-centre first
  return [...features].sort((a, b) => {
    const d = sign * (dist(centres.get(codeOf(a))!, from) - dist(centres.get(codeOf(b))!, from));
    return d !== 0 ? d : codeOf(a).localeCompare(codeOf(b));
  });
}

/**
 * The region CODES covering `pct` of the host's area, walking the given order.
 * Area-weighted, so a single vast region can account for the whole advance.
 */
export function occupiedCodes(ordered: GeoFeature[], pct: number): Set<string> {
  const taken = new Set<string>();
  if (pct <= 0 || ordered.length === 0) return taken;
  const areas = ordered.map(featureArea);
  const total = areas.reduce((a, b) => a + b, 0);
  if (total <= 0) return taken;
  const target = (Math.min(100, pct) / 100) * total;
  let acc = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (acc >= target) break;
    taken.add(codeOf(ordered[i]));
    acc += areas[i];
  }
  return taken;
}
