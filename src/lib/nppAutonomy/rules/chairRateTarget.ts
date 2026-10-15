/**
 * Autonomous central-bank chairs target a neutral rate adjusted for inflation
 * and growth gaps. Chair alignment changes the weights and inflation target;
 * see computeNppChairRateTarget.
 */
import { chairAlignmentPolicy, type ChairAlignment } from "@/lib/centralBank/chairAlignment";
import {
  NPP_CHAIR_GROWTH_COEF,
  NPP_CHAIR_INFLATION_COEF,
  NPP_CHAIR_NAIRU,
  NPP_CHAIR_OUTPUT_GAP_CLAMP,
  NPP_CHAIR_OUTPUT_GAP_COEF,
  NPP_CHAIR_RATE_FLOOR,
  NPP_CHAIR_TARGET_GROWTH,
  NPP_CHAIR_UNEMPLOYMENT_COEF,
  NPP_CHAIR_UNEMPLOYMENT_GAP_MAX,
  NPP_CHAIR_UNEMPLOYMENT_GAP_MIN,
} from "@/lib/db/types/centralBank";

/**
 * Measured real-activity inputs for the autonomous chair's activity rule.
 * `outputGap` is null when the country's regions carry no measured gap yet.
 */
export interface ChairActivityInputs {
  outputGap: number | null;
  unemploymentRate: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

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

/**
 * Activity-rule target for AI-run chairs (chairMode "npp"). Replaces the raw
 * GDP-growth term with the measured output gap and unemployment above NAIRU.
 * Raw growth is noise on a live world (prod t199: growth read 6 to 14% while
 * output gaps sat near 0 and unemployment near 12%), and the growth term alone
 * added 3 to 9 points to dove chairs' targets, holding real rates near 6% in a
 * slump. Player chairs and committee seats keep computeNppChairRateTarget.
 */
export function computeNppChairActivityTarget(params: {
  neutralRate: number;
  inflationRate: number;
  targetInflation: number;
  activity: ChairActivityInputs;
  alignment?: ChairAlignment | null;
}): number {
  const policy = chairAlignmentPolicy(params.alignment);
  const effectiveTargetInflation = params.targetInflation + policy.targetInflationDelta;
  const gap =
    params.activity.outputGap != null && Number.isFinite(params.activity.outputGap)
      ? clamp(params.activity.outputGap, -NPP_CHAIR_OUTPUT_GAP_CLAMP, NPP_CHAIR_OUTPUT_GAP_CLAMP)
      : 0;
  const slack = Number.isFinite(params.activity.unemploymentRate)
    ? clamp(
        params.activity.unemploymentRate - NPP_CHAIR_NAIRU,
        NPP_CHAIR_UNEMPLOYMENT_GAP_MIN,
        NPP_CHAIR_UNEMPLOYMENT_GAP_MAX
      )
    : 0;
  const target =
    params.neutralRate +
    NPP_CHAIR_INFLATION_COEF *
      policy.inflationCoefMult *
      (params.inflationRate - effectiveTargetInflation) +
    policy.growthCoefMult * (NPP_CHAIR_OUTPUT_GAP_COEF * gap - NPP_CHAIR_UNEMPLOYMENT_COEF * slack);
  return Math.max(NPP_CHAIR_RATE_FLOOR, target);
}
