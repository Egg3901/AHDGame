/**
 * Per-move rate limits for the rate-setting UI, built on the same helper the
 * rate API and the committee executor use (`maxHikeDeltaFor`). Pure: no
 * database, clock or React.
 */
import {
  MAX_RATE_CHANGE_DELTA,
  MAX_RATE_CUT_DELTA,
  PRIME_RATE_CEILING,
  PRIME_RATE_STEP,
  maxHikeDeltaFor,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";

export interface RateLimits {
  /** Highest hike (pp) allowed in one move this turn. */
  maxHike: number;
  /** Deepest cut (pp, positive number) allowed in one move. */
  maxCut: number;
  /** Lowest and highest rate reachable in one move from the current rate. */
  floor: number;
  ceiling: number;
  /** True when inflation is far enough over target to widen the hike cap. */
  widened: boolean;
  /** Present when `widened`: the pair behind the widened cap, for the explainer. */
  inflation: number | null;
  target: number | null;
  /** Quick-pick hike sizes (pp) up to the cap, on the quarter-point grid. */
  hikeSteps: number[];
}

export function computeRateLimits(params: {
  primeRate: number;
  inflation?: number | null;
  target?: number | null;
}): RateLimits {
  const { inflation, target } = params;
  const gap =
    typeof inflation === "number" && typeof target === "number" ? inflation - target : null;
  const maxHike = maxHikeDeltaFor(gap);
  const widened = maxHike > MAX_RATE_CHANGE_DELTA;
  // The server measures every limit from the grid-snapped stored rate.
  const base = snapToPrimeRateGrid(params.primeRate);
  const floor = Math.max(0, base - MAX_RATE_CUT_DELTA);
  const ceiling = Math.min(PRIME_RATE_CEILING, base + maxHike);
  const hikeSteps: number[] = [];
  if (widened) {
    const room = ceiling - base;
    for (let step = MAX_RATE_CHANGE_DELTA; step <= room + 1e-9; step += MAX_RATE_CHANGE_DELTA) {
      hikeSteps.push(Math.round(step / PRIME_RATE_STEP) * PRIME_RATE_STEP);
    }
    const top = Math.floor((room + 1e-9) / PRIME_RATE_STEP) * PRIME_RATE_STEP;
    if (top > 0 && !hikeSteps.includes(top)) hikeSteps.push(top);
  }
  return {
    maxHike,
    maxCut: MAX_RATE_CUT_DELTA,
    floor,
    ceiling,
    widened,
    inflation: widened ? (inflation ?? null) : null,
    target: widened ? (target ?? null) : null,
    hikeSteps,
  };
}

/** One plain sentence for why the hike cap is wider than usual; null when it is not. */
export function widenedCapSentence(limits: RateLimits): string | null {
  if (!limits.widened || limits.inflation === null || limits.target === null) return null;
  return `Inflation is ${limits.inflation.toFixed(1)}% against a ${limits.target.toFixed(1)}% target, so this turn you may raise the rate by up to ${limits.maxHike.toFixed(2)} points in one move instead of ${MAX_RATE_CHANGE_DELTA.toFixed(2)}.`;
}
