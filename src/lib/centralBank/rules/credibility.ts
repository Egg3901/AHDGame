/**
 * Central-bank credibility rewards a rate within half a point of the shared
 * policy target. The target depends on neutral rate, inflation, growth and
 * chair alignment; see stanceMatchesTaylorTarget.
 */
import type { ChairAlignment } from "@/lib/centralBank/chairAlignment";
import { computeNppChairRateTarget } from "@/lib/nppAutonomy/rules/chairRateTarget";

/** Existing corridor tolerance: 0.5 percentage points around policy target. */
export const CREDIBILITY_TARGET_BAND = 0.5;

export function stanceMatchesTaylorTarget(params: {
  primeRate: number;
  neutralRate: number;
  inflation: number;
  targetInflation: number;
  gdpGrowth: number;
  alignment?: ChairAlignment | null;
}): boolean {
  const targetRate = computeNppChairRateTarget({
    neutralRate: params.neutralRate,
    inflationRate: params.inflation,
    targetInflation: params.targetInflation,
    gdpGrowth: params.gdpGrowth,
    alignment: params.alignment,
  });
  return Math.abs(params.primeRate - targetRate) < CREDIBILITY_TARGET_BAND;
}
