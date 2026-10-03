/**
 * A faster path writer for the landing globe's spin. d3-geo rotates, clips
 * and resamples every vertex through a chain of stream objects on every frame,
 * which on the hero globe costs about 30 ms a frame on a desktop CPU and
 * starves the main thread on a phone. Most countries are either wholly on the
 * near side or wholly on the far side at any moment, and neither needs a clip.
 *
 * So each geometry is prepared once: densified so no edge spans more than
 * `MAX_STEP_DEG` (straight segments then trace great circles to well under a
 * pixel, which is what d3's resampling was for), turned into unit vectors, and
 * bounded by a spherical cap. Per frame, a country whose cap is wholly behind
 * the globe is skipped, one wholly in front is projected with a 3x3 rotation,
 * and only the few that straddle the horizon go through d3. Lines (graticule,
 * border meshes) are cut at the horizon directly.
 *
 * Works on the orthographic projection the landing globe uses, centred on the
 * rotated origin. Takes the d3 rotation function rather than importing d3-geo,
 * which the globe loads lazily.
 */
import type { Feature, Geometry, LineString, MultiLineString, Position } from "geojson";

type Rotate = (point: [number, number]) => [number, number];
type PathGenerator = (object: unknown) => string | null;

const RAD = Math.PI / 180;
const MAX_STEP_DEG = 1.5;
const MAX_STEP = MAX_STEP_DEG * RAD;

type Vec = [number, number, number];

function toVec([lon, lat]: Position): Vec {
  const cosLat = Math.cos(lat * RAD);
  return [cosLat * Math.cos(lon * RAD), cosLat * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

function angle(a: Vec, b: Vec): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Unit vectors along a ring or line, with great-circle points added on long edges. */
function densify(points: readonly Position[]): Float64Array {
  const out: number[] = [];
  let prev: Vec | null = null;
  for (const position of points) {
    const v = toVec(position);
    if (prev) {
      const theta = angle(prev, v);
      if (theta > MAX_STEP) {
        const steps = Math.ceil(theta / MAX_STEP);
        const sin = Math.sin(theta);
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          const a = Math.sin((1 - t) * theta) / sin;
          const b = Math.sin(t * theta) / sin;
          out.push(a * prev[0] + b * v[0], a * prev[1] + b * v[1], a * prev[2] + b * v[2]);
        }
      }
    }
    out.push(v[0], v[1], v[2]);
    prev = v;
  }
  return Float64Array.from(out);
}

/** The smallest-ish cap holding every vertex: centred on their mean direction. */
type Cap = { center: Vec; radius: number };

function boundingCap(parts: readonly Float64Array[]): Cap {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 3) {
      x += part[i];
      y += part[i + 1];
      z += part[i + 2];
    }
  }
  const length = Math.hypot(x, y, z);
  // A shape balanced around the sphere has no useful cap; it always straddles.
  if (length < 1e-9) return { center: [1, 0, 0], radius: Math.PI };
  const center: Vec = [x / length, y / length, z / length];
  let radius = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 3) {
      radius = Math.max(radius, angle(center, [part[i], part[i + 1], part[i + 2]]));
    }
  }
  return { center, radius };
}

type PreparedPolygons = { rings: Float64Array[]; cap: Cap };
type PreparedLines = { lines: Float64Array[] };

function polygonsOf(geometry: Geometry | null | undefined): Position[][][] | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return null;
}

function linesOf(geometry: LineString | MultiLineString): Position[][] {
  return geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
}

// Geometry objects are stable for the life of the globe, so preparation is
// cached on them and done once, on the first frame that draws them.
const polygonCache = new WeakMap<object, PreparedPolygons | null>();
const lineCache = new WeakMap<object, PreparedLines>();

function preparePolygons(feature: Feature): PreparedPolygons | null {
  let prepared = polygonCache.get(feature);
  if (prepared === undefined) {
    const polygons = polygonsOf(feature.geometry);
    if (polygons) {
      const rings = polygons.flatMap((polygon) => polygon.map(densify));
      prepared = { rings, cap: boundingCap(rings) };
    } else {
      prepared = null;
    }
    polygonCache.set(feature, prepared);
  }
  return prepared;
}

function prepareLines(geometry: LineString | MultiLineString): PreparedLines {
  let prepared = lineCache.get(geometry);
  if (!prepared) {
    prepared = { lines: linesOf(geometry).map(densify) };
    lineCache.set(geometry, prepared);
  }
  return prepared;
}

const round = (n: number) => Math.round(n * 10) / 10;

export type GlobeFrame = {
  /** A country's `d`, or null when it is wholly on the far side. */
  feature(feature: Feature): string | null;
  /** A line or mesh cut at the horizon. Empty when none of it is in front. */
  lines(geometry: LineString | MultiLineString): string;
};

/**
 * One frame's projector. `pathGen` must be d3's path for the same rotation,
 * scale and translate; it draws the countries that cross the horizon.
 */
export function createGlobeFrame(
  rotate: Rotate,
  scale: number,
  translate: readonly [number, number],
  pathGen: PathGenerator
): GlobeFrame {
  // The rotation is linear on unit vectors, so three rotated basis vectors
  // give its matrix. Orthographic x and y are the rotated y and z; a point is
  // in front when its rotated x is positive.
  const [ax, ay, az] = toVec(rotate([0, 0]));
  const [bx, by, bz] = toVec(rotate([90, 0]));
  const [cx, cy, cz] = toVec(rotate([0, 90]));
  // The view centre, in the same frame as the prepared vectors.
  const view: Vec = [ax, bx, cx];
  const [tx, ty] = translate;

  const feature = (f: Feature): string | null => {
    const prepared = preparePolygons(f);
    if (!prepared) return pathGen(f);
    const { cap, rings } = prepared;
    const fromCentre = angle(view, cap.center);
    if (fromCentre - cap.radius > Math.PI / 2) return null;
    if (fromCentre + cap.radius >= Math.PI / 2) return pathGen(f);
    let d = "";
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 3) {
        const x = ring[i];
        const y = ring[i + 1];
        const z = ring[i + 2];
        d += `${i === 0 ? "M" : "L"}${round(tx + scale * (ay * x + by * y + cy * z))},${round(
          ty - scale * (az * x + bz * y + cz * z)
        )}`;
      }
      d += "Z";
    }
    return d;
  };

  const lines = (geometry: LineString | MultiLineString): string => {
    let d = "";
    for (const line of prepareLines(geometry).lines) {
      let wasIn = false;
      let px = 0;
      let py = 0;
      let pz = 0;
      let pd = 0;
      for (let i = 0; i < line.length; i += 3) {
        const x = line[i];
        const y = line[i + 1];
        const z = line[i + 2];
        const depth = ax * x + bx * y + cx * z;
        const isIn = depth > 0;
        if (i > 0 && isIn !== wasIn) {
          // Where the segment meets the horizon, pushed back onto the sphere.
          const t = pd / (pd - depth);
          const hx = px + (x - px) * t;
          const hy = py + (y - py) * t;
          const hz = pz + (z - pz) * t;
          const length = Math.hypot(hx, hy, hz) || 1;
          const sx = round(tx + (scale * (ay * hx + by * hy + cy * hz)) / length);
          const sy = round(ty - (scale * (az * hx + bz * hy + cz * hz)) / length);
          d += `${isIn ? "M" : "L"}${sx},${sy}`;
        }
        if (isIn) {
          const sx = round(tx + scale * (ay * x + by * y + cy * z));
          const sy = round(ty - scale * (az * x + bz * y + cz * z));
          d += `${i === 0 ? "M" : "L"}${sx},${sy}`;
        }
        wasIn = isIn;
        px = x;
        py = y;
        pz = z;
        pd = depth;
      }
    }
    return d;
  };

  return { feature, lines };
}
