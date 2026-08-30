/** Fixed plant-sector split rules. This module is deterministic except for the supplied roll. */

export const FIXED_PLANT_SPLIT_FRACTION = 0.01;
export const MIN_PLANT_SPLIT_SUCCESS_PROBABILITY = 0.05;
export const MAX_PLANT_SPLIT_SUCCESS_PROBABILITY = 0.95;
export const PLANT_SPLIT_CASH_BOOK_FRACTION = 0.5;
export const PLANT_SPLIT_MS_LOG_SCALE = 2;

export interface PlantSectorSplitInput {
  /** Whole plants owned by the defender before the attempt. */
  defenderPlantCount: number;
  /** Total paid basis of those plants in anchor currency. */
  defenderBookValueAnchor: number;
  /** Both MS values are read before this attempt deducts its cost. */
  attackerMarketingStrength: number;
  defenderMarketingStrength: number;
}

export interface PlantSectorSplitQuote {
  plantsAtRisk: number;
  trancheBookValueAnchor: number;
  cashCostAnchor: number;
  marketingStrengthCost: number;
  successProbability: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function wholeNonNegative(value: number): number {
  return Math.floor(finiteNonNegative(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Quote one sector-split attempt.
 *
 * The attacker never chooses a percentage. Every eligible attempt risks a
 * fixed 1 percent of the defender's opening whole-plant count, rounded down
 * with a one-plant minimum. The defender always keeps at least one plant.
 */
export function calculatePlantSectorSplit(
  input: PlantSectorSplitInput
): PlantSectorSplitQuote {
  const defenderPlantCount = wholeNonNegative(input.defenderPlantCount);
  const defenderBookValueAnchor = finiteNonNegative(input.defenderBookValueAnchor);
  const attackerMarketingStrength = finiteNonNegative(input.attackerMarketingStrength);
  const defenderMarketingStrength = finiteNonNegative(input.defenderMarketingStrength);

  const plantsAtRisk =
    defenderPlantCount <= 1
      ? 0
      : Math.min(
          defenderPlantCount - 1,
          Math.max(1, Math.floor(defenderPlantCount * FIXED_PLANT_SPLIT_FRACTION))
        );

  const trancheBookValueAnchor =
    defenderPlantCount > 0
      ? (defenderBookValueAnchor * plantsAtRisk) / defenderPlantCount
      : 0;
  const cashCostAnchor = Math.round(
    trancheBookValueAnchor * PLANT_SPLIT_CASH_BOOK_FRACTION
  );
  const marketingStrengthCost =
    plantsAtRisk > 0
      ? PLANT_SPLIT_MS_LOG_SCALE * Math.ceil(Math.log2(1 + defenderPlantCount))
      : 0;

  const totalMarketingStrength = attackerMarketingStrength + defenderMarketingStrength;
  const rawSuccessProbability =
    totalMarketingStrength > 0
      ? attackerMarketingStrength / totalMarketingStrength
      : 0.5;
  const successProbability = clamp(
    rawSuccessProbability,
    MIN_PLANT_SPLIT_SUCCESS_PROBABILITY,
    MAX_PLANT_SPLIT_SUCCESS_PROBABILITY
  );

  return {
    plantsAtRisk,
    trancheBookValueAnchor,
    cashCostAnchor,
    marketingStrengthCost,
    successProbability,
  };
}

/** Resolve a quoted probability from an auditable random roll in [0, 1). */
export function didPlantSectorSplitSucceed(
  successProbability: number,
  randomRoll: number
): boolean {
  if (!Number.isFinite(randomRoll) || randomRoll < 0 || randomRoll >= 1) {
    throw new RangeError("randomRoll must be a finite number in [0, 1)");
  }
  return randomRoll < clamp(successProbability, 0, 1);
}
