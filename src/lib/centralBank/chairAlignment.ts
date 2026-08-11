// src/lib/centralBank/chairAlignment.ts
/**
 * Central-bank chair hawk/dove temperament.
 *
 * Autonomous (chairMode === "npp") chairs set rates via a Taylor rule
 * (`nppChairAutoRate.ts`). Alignment biases that rule without rebuilding it:
 *
 *   - hawk → fights inflation harder (heavier inflation weight, lower inflation
 *     tolerance) and is quicker to hike / slower to cut.
 *   - dove → favors growth (heavier growth weight, higher inflation tolerance)
 *     and is quicker to cut / slower to hike.
 *
 * The seated chair is a technocrat NPP, so a sensible default alignment is
 * derived from its `NPPPersonality` when none is stored. On term-expiry
 * replacement the selector flips alignment (see `oppositeAlignment`) so policy
 * temperament varies over time.
 */

import type { NPPPersonality } from "@/lib/db/types/npp";

export type ChairAlignment = "hawk" | "dove";

export function oppositeAlignment(alignment: ChairAlignment): ChairAlignment {
  return alignment === "hawk" ? "dove" : "hawk";
}

/**
 * Default alignment from personality: a stubborn, less ambitious technocrat
 * leans hawkish (prizes price stability / discipline); an ambitious, flexible
 * one leans dovish (prioritizes growth). Pure and total.
 */
export function deriveChairAlignment(personality: NPPPersonality): ChairAlignment {
  return personality.stubbornness >= personality.ambition ? "hawk" : "dove";
}

export interface ChairAlignmentPolicy {
  /** Multiplies the inflation-gap coefficient in the Taylor rule. */
  inflationCoefMult: number;
  /** Multiplies the growth-gap coefficient in the Taylor rule. */
  growthCoefMult: number;
  /** Added to the inflation target (hawk lowers tolerance, dove raises it). */
  targetInflationDelta: number;
  /** Multiplies the size of a hike (positive rate step). */
  hikeStepMult: number;
  /** Multiplies the size of a cut (negative rate step). */
  cutStepMult: number;
}

/** Neutral policy — used when no alignment is set (preserves legacy behavior). */
export const NEUTRAL_CHAIR_POLICY: ChairAlignmentPolicy = {
  inflationCoefMult: 1,
  growthCoefMult: 1,
  targetInflationDelta: 0,
  hikeStepMult: 1,
  cutStepMult: 1,
};

export const CHAIR_ALIGNMENT_POLICY: Record<ChairAlignment, ChairAlignmentPolicy> = {
  hawk: {
    inflationCoefMult: 1.5,
    growthCoefMult: 0.5,
    targetInflationDelta: -0.5,
    hikeStepMult: 1.25,
    cutStepMult: 0.75,
  },
  dove: {
    inflationCoefMult: 0.6,
    growthCoefMult: 1.5,
    targetInflationDelta: 0.5,
    hikeStepMult: 0.75,
    cutStepMult: 1.25,
  },
};

export function chairAlignmentPolicy(
  alignment: ChairAlignment | null | undefined
): ChairAlignmentPolicy {
  if (alignment === "hawk" || alignment === "dove") return CHAIR_ALIGNMENT_POLICY[alignment];
  return NEUTRAL_CHAIR_POLICY;
}
