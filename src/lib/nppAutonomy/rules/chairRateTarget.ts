/**
 * Autonomous central-bank chairs target a neutral rate adjusted for inflation
 * and growth gaps. Chair alignment changes the weights and inflation target;
 * see computeNppChairRateTarget.
 */
import { chairAlignmentPolicy, type ChairAlignment } from "@/lib/centralBank/chairAlignment";
import {
  NPP_CHAIR_GROWTH_COEF,
  NPP_CHAIR_INFLATION_COEF,
  NPP_CHAIR_TARGET_GROWTH,
} from "@/lib/db/types/centralBank";

/** Shared dual-mandate Taylor target used by autonomous chairs and credibility. */
export function computeNppChairRateTarget(params: {
  neutralRate: number;
  inflationRate: number;
  targetInflation: number;
  gdpGrowth: number;
  alignment?: ChairAlignment | null;
}): number {
  const policy = chairAlignmentPolicy(params.alignment);
  const effectiveTargetInflation = params.targetInflation + policy.targetInflationDelta;
  return (
    params.neutralRate +
    NPP_CHAIR_INFLATION_COEF *
      policy.inflationCoefMult *
      (params.inflationRate - effectiveTargetInflation) +
    NPP_CHAIR_GROWTH_COEF * policy.growthCoefMult * (params.gdpGrowth - NPP_CHAIR_TARGET_GROWTH)
  );
}
