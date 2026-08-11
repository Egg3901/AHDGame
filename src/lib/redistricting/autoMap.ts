import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { RedistrictCaps } from "./caps";
import { largestRemainderAllocate } from "./budget";
import { validateRedistrictMap, computeEfficiencyGap, PACKED_THRESHOLD } from "./legality";

export type AutoMapStrategy =
  "competitive" | "leanLeft" | "leanRight" | "maxLeft" | "maxRight" | "fair";

export interface AutoMapResult {
  /** The generated map, always conserved; legal when `adjusted` is false. */
  map: DistrictSquares[];
  /** True if the ideal layout had to be backed off toward legality. */
  adjusted: boolean;
}

export const AUTO_MAP_STRATEGIES: { id: AutoMapStrategy; label: string; hint: string }[] = [
  { id: "competitive", label: "Competitive", hint: "Maximize toss-up districts" },
  { id: "fair", label: "Fair", hint: "Balanced, low efficiency gap" },
  { id: "leanLeft", label: "Lean Left", hint: "Tilt the map left" },
  { id: "leanRight", label: "Lean Right", hint: "Tilt the map right" },
  { id: "maxLeft", label: "Max Left", hint: "Maximize left-won seats" },
  { id: "maxRight", label: "Max Right", hint: "Maximize right-won seats" },
];

/** Even split of an integer `total` (may be negative) across `n` buckets. */
function distributeEven(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.trunc(total / n);
  let rem = total - base * n; // same sign as total, |rem| < n
  const step = rem > 0 ? 1 : -1;
  const out = new Array(n).fill(base);
  for (let i = 0; rem !== 0; i++, rem -= step) out[i % n] += step;
  return out;
}

/**
 * A symmetric spread of netLeans about `mean`, amplitude `amp`, summing to
 * `n·round(mean)` then nudged toward `total`. Balancing left-won and right-won
 * districts keeps wasted votes symmetric, which is what the efficiency-gap
 * metric rewards — a uniform map is the *worst* for it.
 */
function symmetricRamp(total: number, n: number, amp: number): number[] {
  const mean = total / n;
  const targets: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? mean : mean + amp * ((2 * i) / (n - 1) - 1);
    targets.push(Math.round(t));
  }
  // Correct rounding drift so the spread still sums to `total`.
  return rebalanceSum(targets, total);
}

/** Nudge an integer array's sum to `total` by ±1 adjustments, smallest first. */
function rebalanceSum(arr: number[], total: number): number[] {
  const out = [...arr];
  let drift = total - out.reduce((a, b) => a + b, 0);
  const order = out.map((_, i) => i);
  while (drift !== 0 && order.length > 0) {
    // Spread the correction across distinct districts to keep the shape.
    const step = drift > 0 ? 1 : -1;
    for (let k = 0; k < out.length && drift !== 0; k++) {
      out[k] += step;
      drift -= step;
    }
  }
  return out;
}

/**
 * Seat-maximizing tilt: pack the opposing side into a few districts at the
 * deviation floor/ceil and give the rest a winning margin `margin·dir`. More
 * packed districts ⇒ more seats for `dir`. The efficiency-gap cap usually forces
 * `repairToLegal` to back this off, so each strategy tries several constructions
 * and keeps the best *legal* one.
 */
function buildPackedTilt(
  total: number,
  n: number,
  packVal: number,
  dir: 1 | -1,
  margin: number
): number[] {
  const pack = Math.round(packVal);
  const desired = dir * Math.max(1, margin);
  let p = 0;
  if (desired !== pack) p = Math.round((total - n * desired) / (pack - desired));
  p = Math.max(0, Math.min(n - 1, p));
  if (p === 0) return rebalanceSum(new Array(n).fill(desired), total);
  const rest = distributeEven(total - p * pack, n - p);
  return [...rest, ...new Array(p).fill(pack)];
}

/** Districts won by `dir` (positive netLean for right, negative for left). */
function seatsFor(map: DistrictSquares[], dir: 1 | -1): number {
  return map.filter((d) => Math.sign(d.right - d.left) === dir).length;
}

/** Total absolute lean across a map — how "packed"/extreme its districts are. */
function packedness(map: DistrictSquares[]): number {
  let s = 0;
  for (const d of map) s += Math.abs(d.right - d.left);
  return s;
}

/**
 * Objective for the directional strategies. Lexicographically: (1) maximize *own*
 * seats — a gerrymander is judged by the seats it wins; ranking margin first let
 * maps that converted opponent seats into useless 0-0 ties beat maps that won more
 * seats outright, so Lean Left could underperform even Fair; (2) maximize the seat
 * margin over the opponent to prefer starving the other side among equal-own maps;
 * (3) `packSign` breaks remaining ties — "Max" packs harder (more decisive, safer
 * districts) while "Lean" keeps margins gentle.
 *
 * Both directions rank one shared candidate pool: "Max Right" takes the pool's
 * right-seat maximum and "Max Left" its left-seat maximum, so right seats of the
 * former ≥ right seats of the latter — the two can never invert.
 *
 * Weights (1e6 / 1e3 / ±1) keep the ordering strict: `packedness` ≤ 16·n never
 * reaches 1e3 for any real apportionment, and |margin| ≤ n never reaches 1e6.
 */
function directionalRank(dir: 1 | -1, packSign: 1 | -1): (map: DistrictSquares[]) => number {
  const opp = (dir === 1 ? -1 : 1) as 1 | -1;
  return (map) => {
    const own = seatsFor(map, dir);
    const margin = own - seatsFor(map, opp);
    return own * 1e6 + margin * 1e3 + packSign * packedness(map);
  };
}

/** Toss-up districts: |netLean| below the competitive threshold. */
function tossups(map: DistrictSquares[]): number {
  return map.filter((d) => Math.abs(d.right - d.left) < 3).length;
}

/** Balanced symmetric spreads at several amplitudes — reliably legal anchors. */
function balancedCandidates(total: number, n: number, dev: number, amps: number[]): number[][] {
  return amps.map((a) => symmetricRamp(total, n, Math.min(dev, a)));
}

/** Packed directional tilts at the given winning margins. */
function packedCandidates(
  total: number,
  n: number,
  dir: 1 | -1,
  dev: number,
  margins: number[]
): number[][] {
  const mean = total / n;
  const packVal = dir > 0 ? Math.max(-16, mean - dev) : Math.min(16, mean + dev);
  return margins.map((m) => buildPackedTilt(total, n, packVal, dir, m));
}

/**
 * Packed tilts enumerated by pack *count* rather than by winning margin: exactly
 * `p` districts absorb the opposition at a chosen depth and the remaining n−p
 * split the rest evenly. `buildPackedTilt` derives one pack count per margin, so
 * it explores only a thin slice of the space; sweeping every count (and two pack
 * depths) finds legal seat-maximizing maps the margin sweep misses when the caps
 * leave room for them.
 */
function packedCandidatesByCount(total: number, n: number, dir: 1 | -1, dev: number): number[][] {
  const mean = total / n;
  const out: number[][] = [];
  for (const depth of [dev, Math.max(1, Math.round(dev / 2))]) {
    const packVal = Math.round(dir > 0 ? Math.max(-16, mean - depth) : Math.min(16, mean + depth));
    for (let p = 1; p < n; p++) {
      out.push([...distributeEven(total - p * packVal, n - p), ...new Array(p).fill(packVal)]);
    }
  }
  return out;
}

/**
 * Realize each candidate target set and pick the best one. Among *legal* maps the
 * one with the highest `rankOf` wins (ties broken toward un-adjusted maps); only
 * if no candidate is legal do we fall back to the least-illegal map. Because every
 * strategy includes the balanced anchors, a legal map is virtually always found —
 * so an illegal, seat-inflated gerrymander can never leak out.
 */
function chooseBest(
  candidates: number[][],
  budget: DistrictSquares,
  caps: RedistrictCaps,
  rankOf: (map: DistrictSquares[]) => number
): AutoMapResult {
  let best: {
    map: DistrictSquares[];
    legal: boolean;
    rank: number;
    score: number;
    adjusted: boolean;
  } | null = null;
  for (const targets of candidates) {
    const { map, adjusted } = realize(targets, budget, caps);
    const legal = validateRedistrictMap(map, budget, caps).legal;
    const rank = rankOf(map);
    const score = legal ? 0 : violationScore(map, budget, caps);
    const cand = { map, legal, rank, score, adjusted };
    if (best === null) {
      best = cand;
      continue;
    }
    if (legal !== best.legal) {
      if (legal) best = cand; // a legal map always beats an illegal one
    } else if (legal) {
      // Both legal: maximize the objective, then prefer fewer adjustments.
      if (
        rank > best.rank + 1e-9 ||
        (Math.abs(rank - best.rank) <= 1e-9 && !adjusted && best.adjusted)
      )
        best = cand;
    } else if (score < best.score - 1e-9) {
      best = cand; // both illegal: take the least-illegal
    }
  }
  if (!best) return { map: [], adjusted: false };
  return { map: best.map, adjusted: best.adjusted || !best.legal };
}

/**
 * Convert target netLeans into a conserved integer map, then repair to legal.
 * Grey is spread evenly but nudged so each district's two-party capacity matches
 * its target lean's parity; otherwise a thin odd-margin win (e.g. +1) would round
 * to a 0 tie or an over-packed +2 — the difference between a legal margin-2 map
 * and a weaker one. Each district's left/right split then realizes its target.
 */
function realize(
  targetLeans: number[],
  budget: DistrictSquares,
  caps: RedistrictCaps
): AutoMapResult {
  const grey = allocateGreyForTargets(budget.grey, targetLeans);
  const cap = grey.map((g) => 16 - g); // two-party capacity per district

  // Initial left from each target: netLean = cap − 2·left ⇒ left = (cap − t)/2.
  const left = targetLeans.map((t, i) =>
    Math.max(0, Math.min(cap[i], Math.round((cap[i] - t) / 2)))
  );

  // Conserve total left exactly via single left↔right swaps (grey untouched).
  conserveLeft(left, cap, budget.left);

  const map = left.map((l, i) => ({ left: l, right: cap[i] - l, grey: grey[i] }));
  return repairToLegal(map, budget, caps);
}

/**
 * Even grey split, then parity-matched to the targets: a district's two-party
 * capacity (16 − grey) shares grey's parity, and netLean shares the capacity's
 * parity, so an odd target lean needs odd grey. Parities are corrected in pairs
 * by moving one grey unit between two mismatched districts, which flips both and
 * preserves the conserved grey total exactly. An odd leftover (rare) leaves one
 * district off by a square — harmless, and the repair pass still runs.
 */
function allocateGreyForTargets(greyTotal: number, targets: number[]): number[] {
  const n = targets.length;
  const grey = largestRemainderAllocate(greyTotal, new Array(n).fill(1));
  const want = targets.map((t) => Math.abs(Math.round(t)) % 2);
  const wrong: number[] = [];
  for (let i = 0; i < n; i++) if (grey[i] % 2 !== want[i]) wrong.push(i);
  for (let w = 0; w + 1 < wrong.length; w += 2) {
    const a = wrong[w];
    const b = wrong[w + 1];
    if (grey[a] < 16 && grey[b] > 0) {
      grey[a] += 1;
      grey[b] -= 1;
    } else if (grey[b] < 16 && grey[a] > 0) {
      grey[b] += 1;
      grey[a] -= 1;
    }
  }
  return grey;
}

/** Move single squares between left and right until Σleft === target. */
function conserveLeft(left: number[], cap: number[], target: number): void {
  const netLean = (i: number) => cap[i] - 2 * left[i];
  let delta = target - left.reduce((a, b) => a + b, 0);
  const idx = left.map((_, i) => i);
  // Adding left lowers netLean; prefer the most-overshot district first.
  while (delta > 0) {
    const pick = idx.filter((i) => left[i] < cap[i]).sort((a, b) => netLean(b) - netLean(a))[0];
    if (pick === undefined) break;
    left[pick] += 1;
    delta -= 1;
  }
  while (delta < 0) {
    const pick = idx.filter((i) => left[i] > 0).sort((a, b) => netLean(a) - netLean(b))[0];
    if (pick === undefined) break;
    left[pick] -= 1;
    delta += 1;
  }
}

/**
 * How far a map breaks the caps, in roughly square-sized units (0 ⇒ legal).
 * Conservation and per-district totals are guaranteed by construction, so this
 * scores only deviation, packing, and the efficiency gap.
 */
function violationScore(
  map: DistrictSquares[],
  budget: DistrictSquares,
  caps: RedistrictCaps
): number {
  const n = map.length;
  const mean = n > 0 ? (budget.right - budget.left) / n : 0;
  let score = 0;
  let packed = 0;
  let twoParty = 0;
  for (const d of map) {
    const lean = d.right - d.left;
    score += Math.max(0, Math.abs(lean - mean) - caps.maxDistrictDeviation);
    if (d.left >= PACKED_THRESHOLD || d.right >= PACKED_THRESHOLD || d.grey >= PACKED_THRESHOLD)
      packed += 1;
    twoParty += d.left + d.right;
  }
  score += Math.max(0, packed - caps.maxPackedDistricts) * 8;
  score += Math.max(0, computeEfficiencyGap(map) - caps.efficiencyGapCeiling) * twoParty;
  return score;
}

/**
 * Hill-climb toward legality with conservation-preserving paired swaps (move one
 * square from left→right in district i and right→left in district j). Each step
 * takes the swap that most reduces the violation score and stops the instant the
 * map is legal — so a biased map is pulled back only as far as the caps require.
 * If no swap improves the score, the closest map found is returned.
 */
function repairToLegal(
  map: DistrictSquares[],
  budget: DistrictSquares,
  caps: RedistrictCaps
): AutoMapResult {
  const n = map.length;
  let adjusted = false;
  const K = 5; // only consider the few most-extreme districts as swap partners
  const maxIter = 6 * n + 8;
  for (let iter = 0; iter < maxIter; iter++) {
    const score = violationScore(map, budget, caps);
    if (score <= 1e-9 && validateRedistrictMap(map, budget, caps).legal) {
      return { map, adjusted };
    }

    // Candidate swaps pair high-netLean districts (shed a right square) with
    // low-netLean districts (shed a left square): this pulls extremes toward the
    // mean, shrinking deviation, packing, and packing-driven efficiency gap.
    const order = map.map((_, i) => i).sort((a, b) => netLean(map[b]) - netLean(map[a]));
    const highs = order.filter((i) => map[i].right > 0).slice(0, K);
    const lows = order
      .slice()
      .reverse()
      .filter((i) => map[i].left > 0)
      .slice(0, K);

    let best = { i: -1, j: -1, score };
    for (const i of highs) {
      for (const j of lows) {
        if (i === j) continue;
        const trial = map.slice();
        trial[i] = { ...map[i], left: map[i].left + 1, right: map[i].right - 1 };
        trial[j] = { ...map[j], left: map[j].left - 1, right: map[j].right + 1 };
        const s = violationScore(trial, budget, caps);
        if (s < best.score - 1e-9) best = { i, j, score: s };
      }
    }
    if (best.i < 0) break; // local minimum; return closest legal-ish map
    const { i, j } = best;
    map[i] = { ...map[i], left: map[i].left + 1, right: map[i].right - 1 };
    map[j] = { ...map[j], left: map[j].left - 1, right: map[j].right + 1 };
    adjusted = true;
  }
  return { map, adjusted };
}

function netLean(d: DistrictSquares): number {
  return d.right - d.left;
}

/**
 * Both directions of a tier (Lean or Max) search the *same* candidate pool —
 * balanced anchors plus packed tilts toward both sides — and differ only in their
 * objective (`directionalRank` for +1 vs −1). Drawing from one shared pool of
 * realized maps guarantees `maxRight.skew = max(pool) ≥ min(pool) = maxLeft.skew`,
 * so the two can never invert. Max searches a wider, more aggressive margin set
 * than Lean (a superset), so Max never underperforms Lean.
 */
function directionalPool(
  budget: DistrictSquares,
  caps: RedistrictCaps,
  n: number,
  aggressive: boolean
): number[][] {
  const total = budget.right - budget.left;
  const dev = caps.maxDistrictDeviation;
  const half = Math.max(1, Math.round(dev / 2));
  const third = Math.max(1, Math.round(dev / 3));
  const margins = aggressive ? [half, third, 3, 2, 1] : [half, third, 2, 1];
  const pool = [
    ...balancedCandidates(total, n, dev, [5, 4, 3, 2, 1, 0]),
    ...packedCandidates(total, n, +1, dev, margins),
    ...packedCandidates(total, n, -1, dev, margins),
  ];
  // Max sweeps a strict superset of Lean's pool, preserving Max ≥ Lean.
  if (aggressive) {
    pool.push(...packedCandidatesByCount(total, n, +1, dev));
    pool.push(...packedCandidatesByCount(total, n, -1, dev));
  }
  return pool;
}

function directional(
  budget: DistrictSquares,
  caps: RedistrictCaps,
  n: number,
  dir: 1 | -1,
  aggressive: boolean
): AutoMapResult {
  return chooseBest(
    directionalPool(budget, caps, n, aggressive),
    budget,
    caps,
    directionalRank(dir, aggressive ? 1 : -1)
  );
}

/**
 * Raise the efficiency-gap ceiling to a value that is actually attainable for this
 * budget. In a lopsided state under a strict compactness law, the deviation cap can
 * force every district to the same winner, which makes the efficiency gap
 * irreducibly large — no legal map would exist at all, so neither the governor's
 * hand-drawn map nor any Auto-Map result could ever be submitted. The floor is the
 * lowest gap among balanced constructions that satisfy the deviation and packing
 * caps, plus a hair of slack for integer rounding; when the policy ceiling is
 * already attainable the caps are returned unchanged. Both the redistrict API and
 * the editor must validate against these effective caps.
 */
export function effectiveRedistrictCaps(
  budget: DistrictSquares,
  caps: RedistrictCaps
): RedistrictCaps {
  const n = Math.round((budget.left + budget.right + budget.grey) / 16);
  if (n <= 0 || !caps.canDraw) return caps;
  const relaxed: RedistrictCaps = { ...caps, efficiencyGapCeiling: 1 };
  const total = budget.right - budget.left;
  let minEg = Infinity;
  for (const targets of balancedCandidates(
    total,
    n,
    caps.maxDistrictDeviation,
    [0, 1, 2, 3, 4, 5]
  )) {
    // Realize twice: against the raw caps (repair actively drives the gap down,
    // finding the true reachable minimum) and against relaxed caps (repair fixes
    // only deviation/packing — the reachable map when the raw ceiling is out of
    // range). Either way only deviation/packing-legal maps set the floor.
    for (const capSet of [caps, relaxed]) {
      const { map } = realize(targets, budget, capSet);
      if (!validateRedistrictMap(map, budget, relaxed).legal) continue;
      minEg = Math.min(minEg, computeEfficiencyGap(map));
    }
  }
  if (!Number.isFinite(minEg) || minEg <= caps.efficiencyGapCeiling) return caps;
  return { ...caps, efficiencyGapCeiling: Math.min(1, minEg + 0.005) };
}

/** Order-insensitive identity for a map — same districts ⇒ same signature. */
export function mapSignature(map: DistrictSquares[]): string {
  return map
    .map((d) => `${d.left},${d.right},${d.grey}`)
    .sort()
    .join("|");
}

export interface AutoMapOption extends AutoMapResult {
  strategy: AutoMapStrategy;
  /** False when this state's map laws force the same map as a weaker strategy. */
  distinct: boolean;
  /** When not distinct, the weaker strategy this one collapses onto. */
  sameAs?: AutoMapStrategy;
}

/**
 * Run every strategy against the same budget/caps and mark the ones the state's
 * map laws neutralize. A directional strategy is *not distinct* when its map is
 * identical to Fair's (the laws permit no tilt at all) or, for Max, identical to
 * its Lean counterpart (the laws cap the tilt at Lean strength). The UI disables
 * non-distinct buttons instead of silently handing back a duplicate map.
 */
export function autoMapAll(budget: DistrictSquares, rawCaps: RedistrictCaps): AutoMapOption[] {
  const results = AUTO_MAP_STRATEGIES.map((s) => ({
    strategy: s.id,
    ...autoMap(s.id, budget, rawCaps),
  }));
  const sig = new Map<AutoMapStrategy, string>(
    results.map((r) => [r.strategy, mapSignature(r.map)])
  );
  const collapsesTo = (own: AutoMapStrategy, weaker: AutoMapStrategy[]) =>
    weaker.find((w) => sig.get(w) === sig.get(own));
  const WEAKER: Partial<Record<AutoMapStrategy, AutoMapStrategy[]>> = {
    leanLeft: ["fair"],
    leanRight: ["fair"],
    maxLeft: ["fair", "leanLeft"],
    maxRight: ["fair", "leanRight"],
  };
  return results.map((r) => {
    const sameAs = collapsesTo(r.strategy, WEAKER[r.strategy] ?? []);
    return { ...r, distinct: sameAs === undefined, sameAs };
  });
}

/** Generate a legal, conserved map for the given strategy. */
export function autoMap(
  strategy: AutoMapStrategy,
  budget: DistrictSquares,
  rawCaps: RedistrictCaps
): AutoMapResult {
  const caps = effectiveRedistrictCaps(budget, rawCaps);
  const n = Math.round((budget.left + budget.right + budget.grey) / 16);
  if (n <= 0) return { map: [], adjusted: false };
  if (n === 1) {
    return {
      map: [{ left: budget.left, right: budget.right, grey: budget.grey }],
      adjusted: false,
    };
  }
  const total = budget.right - budget.left;
  const dev = caps.maxDistrictDeviation;

  switch (strategy) {
    case "fair":
      // Among legal balanced spreads, the one with the lowest efficiency gap.
      return chooseBest(
        balancedCandidates(total, n, dev, [5, 4, 3, 2, 1, 0]),
        budget,
        caps,
        (m) => -computeEfficiencyGap(m)
      );
    case "competitive":
      // Among legal spreads, the one with the most toss-up districts.
      return chooseBest(
        balancedCandidates(total, n, dev, [0, 1, 2, 3, 4, 5]),
        budget,
        caps,
        tossups
      );
    case "leanRight":
      return directional(budget, caps, n, +1, false);
    case "maxRight":
      return directional(budget, caps, n, +1, true);
    case "leanLeft":
      return directional(budget, caps, n, -1, false);
    case "maxLeft":
      return directional(budget, caps, n, -1, true);
  }
}
