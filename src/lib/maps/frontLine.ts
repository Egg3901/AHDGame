/**
 * A CONTINUOUS front line across a host country, derived from a single control
 * number plus an axis of advance.
 *
 * This replaces `frontGeometry`'s per-region swap for the conflict record's map.
 * The old ordering answers "which whole regions has the advance taken?", which is
 * the right question for a coarse meter and the wrong one for a picture of a war:
 * with no occupier (`occupationOf` returns null whenever the host fights on
 * neither side) `orderFeatures` falls back to a periphery-inward walk, which is
 * why a Warsaw Pact holding 80% of Germany still painted Berlin, Saxony and
 * Mecklenburg blue.
 *
 * Here the axis runs from the ADVANCING SIDE's own anchor into the host, so a
 * conflict with no occupier still has a real, expected orientation. `control`
 * alone drives the line's position and nothing new is persisted.
 *
 * Pure and px-space: the caller projects lon/lat geometry (see `projectRegions`)
 * and passes the result in. Ported from the Conflict Page front-line design
 * project (`front.js`).
 */

export interface FrontBox {
  w: number;
  h: number;
}

export type PxPoint = [number, number];
export type PxRing = PxPoint[];

/** Grid step, in px, for the land sample. Matches the design's `LAND.step`. */
export const LAND_STEP = 10;

/**
 * Cell centres of a `step` grid that fall inside the ring set, by scanline.
 *
 * Even-odd fill, so a hole ring (Brandenburg carries Berlin as an enclave)
 * subtracts and the separate feature drawn over it adds back — the same rule the
 * browser applies to the rendered paths, so the sample matches the picture.
 *
 * The sample is what makes `pct` a true share of the host's LAND rather than a
 * share of a diagonal bounding box, which is the difference between "the Pact
 * holds 80% of Germany" and "the line sits 80% of the way across a rectangle".
 */
export function sampleLand(rings: PxRing[], box: FrontBox, step: number = LAND_STEP): PxPoint[] {
  const cols = Math.max(1, Math.ceil(box.w / step));
  const rows = Math.max(1, Math.ceil(box.h / step));

  // Horizontal edges never cross a scanline; dropping them here keeps the
  // crossing test below free of a divide-by-zero case.
  const edges: Array<[number, number, number, number]> = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  if (edges.length === 0) return [];

  const out: PxPoint[] = [];
  const xs: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * step;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      // Half-open span, so a vertex sitting exactly on the scanline is counted
      // once rather than twice (which would invert the inside/outside parity).
      if (y1 <= y === y2 <= y) continue;
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = xs[k];
      const to = xs[k + 1];
      for (let c = Math.max(0, Math.ceil(from / step - 0.5)); c < cols; c++) {
        const x = (c + 0.5) * step;
        if (x > to) break;
        out.push([x, y]);
      }
    }
  }
  return out;
}

export interface FrontLine {
  /** Unit vector of the advance, anchor → host centre. */
  u: PxPoint;
  /** Unit vector along the line itself (perpendicular to `u`). */
  v: PxPoint;
  /** Where the line sits along `u`. */
  tFront: number;
  /** SVG path of the line. */
  line: string;
  /** Closed SVG path of the ground BEHIND the line — the advancing side's. */
  taken: string;
  /**
   * A px point's signed distance from the line along the axis. Negative is the
   * advancing side; |gap| under a threshold is contested ground.
   */
  gap: (p: PxPoint) => number;
  /** Whether a px point sits on the advancing side. */
  held: (p: PxPoint) => boolean;
}

/**
 * The line is jittered along `u` by a deterministic sum of sines, so it reads as
 * terrain rather than a ruler and is identical on every render — no rng, so the
 * server-rendered and hydrated pictures agree.
 */
const jitter = (s: number): number =>
  9 * Math.sin(s * 0.037) + 5.5 * Math.sin(s * 0.091 + 1.7) + 3 * Math.sin(s * 0.191 + 0.4);

/** The jitter's amplitude bound — how far the line can wave off its nominal position. */
const JITTER_MAX = 9 + 5.5 + 3;

/** Sample spacing along the line, and how far past the box it is drawn. */
const LINE_STEP = 11;
const LINE_PAD = 40;
/** How far behind the line the "taken" fill extends — well past any host box. */
const BACKFILL = 4000;

/**
 * The front line for an advance of `pct` percent of the host's land, running from
 * `anchor` toward the host's centre.
 *
 * Returns null when there is no land to place a line on — the caller degrades to
 * the control meter, exactly as `FrontMap` does for a host with no geometry.
 */
export function frontLine(
  box: FrontBox,
  land: PxPoint[],
  anchor: PxPoint,
  pct: number
): FrontLine | null {
  if (land.length === 0) return null;

  const cx = box.w / 2;
  const cy = box.h / 2;
  let ux = cx - anchor[0];
  let uy = cy - anchor[1];
  const len = Math.hypot(ux, uy);
  // An anchor sitting on the host's own centre gives no direction at all. The
  // caller picks the anchor, so this is a guard, not a policy: fail rather than
  // emit a NaN path.
  if (!Number.isFinite(len) || len < 1e-6) return null;
  ux /= len;
  uy /= len;
  const vx = -uy;
  const vy = ux;

  // The line must cross the whole drawing box, so its PERPENDICULAR extent comes
  // from the box corners; its POSITION comes from the sampled land.
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const [x, y] of [
    [0, 0],
    [box.w, 0],
    [0, box.h],
    [box.w, box.h],
  ]) {
    const s = x * vx + y * vy;
    if (s < sMin) sMin = s;
    if (s > sMax) sMax = s;
  }

  const dots = land.map((p) => p[0] * ux + p[1] * uy).sort((a, b) => a - b);
  const tMin = dots[0];
  const tMax = dots[dots.length - 1];
  const frac = Math.max(0, Math.min(100, pct)) / 100;
  const idx = Math.min(dots.length - 1, Math.max(0, Math.round(frac * (dots.length - 1))));
  // The poles are EXACT: a side holding none of the host must hold none of it on
  // the map. Left as a plain quantile, the jitter waves the line past the
  // outermost land and paints slivers of the wrong colour at 0% and 100%.
  const tFront = frac <= 0 ? tMin - JITTER_MAX - 1 : frac >= 1 ? tMax + JITTER_MAX + 1 : dots[idx];

  const pts: PxPoint[] = [];
  for (let s = sMin - LINE_PAD; s <= sMax + LINE_PAD; s += LINE_STEP) {
    const t = tFront + jitter(s);
    pts.push([ux * t + vx * s, uy * t + vy * s]);
  }
  const fmt = (p: PxPoint) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  const line = `M${pts.map(fmt).join("L")}`;

  const back = tMin - BACKFILL;
  const tail: PxPoint[] = [
    [ux * back + vx * (sMax + LINE_PAD), uy * back + vy * (sMax + LINE_PAD)],
    [ux * back + vx * (sMin - LINE_PAD), uy * back + vy * (sMin - LINE_PAD)],
  ];
  const taken = `M${[...pts, ...tail].map(fmt).join("L")}Z`;

  const gap = (p: PxPoint) => p[0] * ux + p[1] * uy - (tFront + jitter(p[0] * vx + p[1] * vy));

  return {
    u: [ux, uy],
    v: [vx, vy],
    tFront,
    line,
    taken,
    gap,
    held: (p: PxPoint) => gap(p) < 0,
  };
}
