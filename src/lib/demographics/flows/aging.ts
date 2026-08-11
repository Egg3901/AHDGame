import type { AgeSexVector } from "../cohortVector";

/**
 * Continuous (per-turn) aging (design §4.2, smoothed): each turn, a fraction
 * `1/turnsPerYear` of every single-year cohort graduates to the next age. Over a
 * full game-year the cumulative effect ≈ one single-year shift, but spread across
 * the 48 weeks so population / median-age / eligible-voter graphs move gradually
 * instead of in an annual sawtooth. Conserves total population (graduation is
 * internal — every cohort's outflow becomes the next cohort's inflow; births /
 * deaths / migration are the only headcount changes). Index 100 ("100+") absorbs
 * its inflow and never ages out — mortality at the 100+ terminal caps that tail.
 * Age 0 graduates out and is refilled by fertility afterward (this function only
 * graduates the existing stock).
 */
export function applyContinuousAging(vector: AgeSexVector, turnsPerYear: number): AgeSexVector {
  const rate = 1 / turnsPerYear;
  const step = (src: number[]): number[] => {
    const out = src.slice();
    for (let a = 0; a <= 100; a++) {
      const inflow = a >= 1 ? (src[a - 1] ?? 0) * rate : 0; // graduates from a-1
      const outflow = a < 100 ? (src[a] ?? 0) * rate : 0; // age 100 never ages out
      out[a] = (src[a] ?? 0) + inflow - outflow;
    }
    return out;
  };
  return { male: step(vector.male), female: step(vector.female) };
}
