/**
 * Drop coastline detail that is invisible on the /world orthographic globe.
 *
 * Region-overlay blobs (especially `ru-regions.json`) are authored for nation
 * maps. Projecting them raw every animation frame is what made /world crawl —
 * measured ~313ms/frame vs ~9ms for countries-110m alone. This keeps the
 * silhouette and drops sub-pixel wiggles + tiny islands.
 */

type Ring = number[][];
type Poly = Ring[];
type MultiPoly = Poly[];

/** Degrees² — rings smaller than this vanish at globe scale. */
export const GLOBE_MIN_RING_AREA = 0.05;
/** Target spacing along a ring perimeter, in degrees. */
export const GLOBE_RING_STEP = 0.5;

function ringAreaDeg2(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function ringPerimeter(ring: Ring): number {
  let perim = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    perim += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
  }
  return perim;
}

/**
 * Resample a ring to roughly one vertex per `step` degrees of perimeter.
 * Returns null when the ring is too small to matter on the globe.
 */
export function simplifyGlobeRing(
  ring: Ring,
  minArea: number = GLOBE_MIN_RING_AREA,
  step: number = GLOBE_RING_STEP
): Ring | null {
  if (ring.length < 4) return null;
  if (ringAreaDeg2(ring) < minArea) return null;

  const perim = ringPerimeter(ring);
  const target = Math.max(8, Math.min(ring.length - 1, Math.ceil(perim / step)));
  if (target >= ring.length - 1) return ring;

  const out: Ring = [];
  const stride = (ring.length - 1) / target;
  for (let i = 0; i < target; i++) {
    out.push(ring[Math.floor(i * stride)]!);
  }
  const first = out[0]!;
  out.push([first[0], first[1]]);
  return out.length >= 4 ? out : null;
}

/** Simplify a MultiPolygon in lon/lat for /world globe + flat world projection. */
export function simplifyForGlobe(
  coords: MultiPoly,
  minArea: number = GLOBE_MIN_RING_AREA,
  step: number = GLOBE_RING_STEP
): MultiPoly {
  const out: MultiPoly = [];
  for (const poly of coords) {
    const rings: Poly = [];
    for (let ri = 0; ri < poly.length; ri++) {
      // Holes can be smaller than the outer ring and still matter visually —
      // keep a lower floor so we don't fill lakes back in.
      const floor = ri === 0 ? minArea : minArea * 0.25;
      const simplified = simplifyGlobeRing(poly[ri]!, floor, step);
      if (simplified) rings.push(simplified);
    }
    if (rings.length) out.push(rings);
  }
  return out;
}
