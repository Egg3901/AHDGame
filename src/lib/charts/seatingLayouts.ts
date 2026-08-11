/**
 * Pure seat-geometry helpers for the vote-colored seating chart.
 *
 * All three chamber geometries live here so they are testable in isolation and
 * share the lib/charts home:
 *  - `hemicycleLayout` — US / DE / JP / CN
 *  - `benchLayout`     — Westminster (UK)
 *  - `horseshoeLayout` — Dáil Éireann (IE)
 *
 * Coordinates are in a unit system; the renderer supplies its own viewBox.
 * Ported from the approved Legislation Redesign prototype (viz.jsx).
 */
export interface SeatPoint {
  x: number;
  y: number;
}

export interface HorseshoeLayout {
  pts: SeatPoint[];
  seatR: number;
  /** [minX, minY, width, height] for the SVG viewBox */
  vb: [number, number, number, number];
  /** y-coordinate of the Ceann Comhairle's chair */
  chairY: number;
}

/** Hemicycle layout in a unit system (matches the prototype's proportions). */
export function hemicycleLayout(
  total: number,
  innerFactor = 0.5
): { pts: SeatPoint[]; seatR: number } {
  if (total <= 0) return { pts: [], seatR: 0.02 };
  // Cap rows by total so a tiny chamber can't force more min-1 rows than seats,
  // which would otherwise wedge the down-adjust loop below in an infinite spin.
  const rows = Math.min(Math.max(3, Math.round(0.42 * Math.sqrt(total))), total);
  const radii: number[] = [];
  for (let i = 0; i < rows; i++) {
    radii.push(innerFactor + (1 - innerFactor) * (rows === 1 ? 1 : i / (rows - 1)));
  }
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.floor((total * r) / sum)));
  let assigned = counts.reduce((a, b) => a + b, 0);
  let i = rows - 1;
  while (assigned < total) {
    counts[i]++;
    assigned++;
    i = (i - 1 + rows) % rows;
  }
  while (assigned > total) {
    if (counts[i] > 1) {
      counts[i]--;
      assigned--;
    }
    i = (i - 1 + rows) % rows;
  }
  const pts: SeatPoint[] = [];
  for (let r = 0; r < rows; r++) {
    const cnt = counts[r];
    const rad = radii[r];
    for (let s = 0; s < cnt; s++) {
      const pad = 0.5 / cnt;
      const t = cnt === 1 ? 0.5 : s / (cnt - 1);
      const ang = Math.PI * (1 - (pad + t * (1 - 2 * pad)));
      pts.push({ x: Math.cos(ang) * rad, y: -Math.sin(ang) * rad });
    }
  }
  pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  return { pts, seatR: Math.max(0.018, (1 - innerFactor) / (rows * 2.15)) };
}

/** Two stacked benches + detached crossbench block (Westminster). */
export function benchLayout(total: number): {
  pts: SeatPoint[];
  seatR: number;
  w: number;
  h: number;
} {
  if (total <= 0) return { pts: [], seatR: 0.36, w: 1, h: 1 };
  const cross = Math.round(total * 0.1);
  const main = total - cross;
  const topN = Math.round(main * 0.46);
  const bottomN = main - topN;
  const C = Math.max(14, Math.round(Math.sqrt(main) * 1.6));
  const topRows = Math.ceil(topN / C);
  const bottomRows = Math.ceil(bottomN / C);
  const aisle = 1.5;
  const bottomY0 = topRows + aisle;
  const h = bottomY0 + bottomRows;
  const top: SeatPoint[] = [];
  const bottom: SeatPoint[] = [];
  const crossArr: SeatPoint[] = [];
  for (let k = 0; k < topN; k++) top.push({ x: k % C, y: Math.floor(k / C) });
  for (let k = 0; k < bottomN; k++) bottom.push({ x: k % C, y: bottomY0 + Math.floor(k / C) });
  const crossRows = Math.max(1, Math.round(h));
  const crossCols = Math.max(1, Math.ceil(cross / crossRows));
  const crossX0 = C + 1.6;
  const crossYpad = Math.max(0, (h - Math.min(crossRows, Math.ceil(cross / crossCols))) / 2);
  for (let k = 0; k < cross; k++) {
    crossArr.push({ x: crossX0 + Math.floor(k / crossRows), y: crossYpad + (k % crossRows) });
  }
  // order: government (bottom) · crossbench · opposition (top) — matches vote order for|…|against
  const pts = [...bottom, ...crossArr, ...top];
  return { pts, seatR: 0.36, w: crossX0 + crossCols, h };
}

/**
 * Dáil Éireann "horseshoe": a hemicycle fan across the top whose two ends
 * descend into vertical bench "legs" on the left and right, with the Ceann
 * Comhairle's chair at the centre of the open mouth.
 */
export function horseshoeLayout(total: number): HorseshoeLayout {
  const Rarc = 5; // arc rings == bench columns per leg
  const innerR = 0.44;
  const outerR = 1.0;
  const ringR: number[] = [];
  for (let i = 0; i < Rarc; i++) {
    ringR.push(innerR + (outerR - innerR) * (i / (Rarc - 1)));
  }
  const rowGap = (outerR - innerR) / (Rarc - 1);
  const seatR = rowGap * 0.36;
  const arcMin = Rarc * 3; // each of the 5 rings holds at least 3 arc seats
  // Leg depth scales with chamber size, but never so deep that the legs alone
  // overshoot the seat budget — keeps the natural seat count tracking `total`
  // so the trim/pad safety net below stays cosmetic for realistic chambers.
  const legFit = Math.floor((total - arcMin) / (2 * Rarc));
  const legRows = Math.max(3, Math.min(Math.round((total * 0.56) / (2 * Rarc)), legFit));
  const arcTotal = Math.max(arcMin, total - 2 * Rarc * legRows);

  // arc counts per ring proportional to radius
  const sum = ringR.reduce((a, b) => a + b, 0);
  const arcCounts = ringR.map((r) => Math.max(3, Math.round((arcTotal * r) / sum)));
  let diff = arcTotal - arcCounts.reduce((a, b) => a + b, 0);
  let gi = Rarc - 1;
  while (diff !== 0) {
    const nv = arcCounts[gi] + (diff > 0 ? 1 : -1);
    if (nv >= 3) {
      arcCounts[gi] = nv;
      diff += diff > 0 ? -1 : 1;
    }
    gi = (gi - 1 + Rarc) % Rarc;
  }

  const leftLeg: SeatPoint[] = [];
  const arc: Array<SeatPoint & { key: number }> = [];
  const rightLeg: SeatPoint[] = [];

  for (let i = 0; i < Rarc; i++) {
    const cnt = arcCounts[i];
    const rad = ringR[i];
    for (let s = 0; s < cnt; s++) {
      const t = cnt === 1 ? 0.5 : s / (cnt - 1);
      const ang = Math.PI * (1 - t);
      arc.push({ x: Math.cos(ang) * rad, y: -Math.sin(ang) * rad, key: ang });
    }
  }
  arc.sort((a, b) => b.key - a.key); // left (180°) → right (0°)

  for (let c = 0; c < Rarc; c++) {
    const x = ringR[c];
    for (let j = 0; j < legRows; j++) {
      const y = (j + 1) * rowGap;
      leftLeg.push({ x: -x, y });
      rightLeg.push({ x, y });
    }
  }
  leftLeg.sort((a, b) => a.x - b.x || b.y - a.y); // outer col first, bottom→top
  rightLeg.sort((a, b) => a.x - b.x || a.y - b.y); // inner col first, top→bottom

  let pts: SeatPoint[] = [...leftLeg, ...arc.map(({ x, y }) => ({ x, y })), ...rightLeg];

  // The proportional packing can overshoot/undershoot `total` by a few seats;
  // trim or pad (padding repeats the last seat position) so callers always get
  // exactly `total` points.
  if (pts.length > total) {
    pts = pts.slice(0, total);
  } else if (pts.length < total) {
    const last = pts[pts.length - 1] ?? { x: 0, y: 0 };
    while (pts.length < total) pts.push({ ...last });
  }

  const legDepth = (legRows + 1) * rowGap;
  return {
    pts,
    seatR,
    vb: [-1.14, -1.1, 2.28, 1.12 + legDepth],
    chairY: legDepth - rowGap * 0.5,
  };
}
