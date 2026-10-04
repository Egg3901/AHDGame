/**
 * Manufacturing product lines redirect recipe value into modeled goods and add a bounded quality
 * contribution from paid development. The portable rules are allocateManufacturedOutput and
 * productQualityForCommodity.
 */
import type { CommodityType } from "@/lib/constants/commodities";

export type ManufacturingLifecycleStage =
  "development" | "launch" | "growth" | "mature" | "decline" | "retired";

export interface PaidDevelopmentProgress {
  currentPaidAnchor: number;
  additionalPaidAnchor: number;
  elapsedTurns: number;
  paidThresholdAnchor: number;
  elapsedThresholdTurns: number;
}

export interface PaidDevelopmentState {
  paidAnchor: number;
  elapsedTurns: number;
  ready: boolean;
}

export interface ManufacturedOutputAllocationInput {
  /** Nameplate revenue basis in anchor currency per day, derived from real plant capacity. */
  outputAnchor: number;
  /** Current strategy's nominal output coefficients, not unit counts. */
  supplyRates: Partial<Record<CommodityType, number>>;
  /** Share of this plant's capacity assigned to the active product line. */
  allocationShare: number;
  stage: ManufacturingLifecycleStage;
  outputCommodity: CommodityType;
  /** Commodity base prices in the same anchor basis as outputAnchor. */
  basePrices: Partial<Record<CommodityType, number>>;
}

export interface ManufacturedOutputAllocation {
  nominalOutputAnchorByCommodity: Partial<Record<CommodityType, number>>;
  outputUnitsByCommodity: Partial<Record<CommodityType, number>>;
  /** Recipe input demand follows assigned plant capacity once, not output item count. */
  inputThroughputShare: number;
}

const OUTPUT_REDIRECT_BY_STAGE: Record<ManufacturingLifecycleStage, number> = {
  development: 0,
  launch: 0.15,
  growth: 0.4,
  mature: 0.7,
  decline: 0.4,
  retired: 0,
};

const QUALITY_STAGE_FACTOR: Record<ManufacturingLifecycleStage, number> = {
  development: 0,
  launch: 0.25,
  growth: 0.6,
  mature: 1,
  decline: 0.6,
  retired: 0,
};

const MAX_PAID_DEVELOPMENT_QUALITY = 10;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Advances development only from paid cash and elapsed turns. */
export function advancePaidDevelopment(input: PaidDevelopmentProgress): PaidDevelopmentState {
  const paidAnchor =
    finiteNonNegative(input.currentPaidAnchor) + finiteNonNegative(input.additionalPaidAnchor);
  const elapsedTurns = Math.floor(finiteNonNegative(input.elapsedTurns));
  const paidThresholdAnchor = finiteNonNegative(input.paidThresholdAnchor);
  const elapsedThresholdTurns = Math.floor(finiteNonNegative(input.elapsedThresholdTurns));
  return {
    paidAnchor,
    elapsedTurns,
    ready: paidAnchor >= paidThresholdAnchor && elapsedTurns >= elapsedThresholdTurns,
  };
}

/**
 * Redirects part of a plant's existing nominal recipe value to the product output. Quantity is
 * computed only after value is conserved, so a costly output cannot multiply recipe value.
 */
export function allocateManufacturedOutput(
  input: ManufacturedOutputAllocationInput
): ManufacturedOutputAllocation {
  const outputAnchor = finiteNonNegative(input.outputAnchor);
  const allocationShare = clamp(finiteNonNegative(input.allocationShare), 0, 1);
  const outputRates = Object.entries(input.supplyRates ?? {}) as Array<[CommodityType, number]>;
  const totalRate = outputRates.reduce((sum, [, rate]) => sum + finiteNonNegative(rate), 0);
  const redirectedShare = OUTPUT_REDIRECT_BY_STAGE[input.stage];
  const allocatedRecipeAnchor = outputAnchor * allocationShare * totalRate;
  const redirectedAnchor = allocatedRecipeAnchor * redirectedShare;
  const nominalOutputAnchorByCommodity: Partial<Record<CommodityType, number>> = {};

  for (const [commodity, rawRate] of outputRates) {
    const rate = finiteNonNegative(rawRate);
    if (rate <= 0) continue;
    const baseAnchor = outputAnchor * allocationShare * rate;
    const remainingAnchor = baseAnchor - redirectedAnchor * (rate / totalRate);
    nominalOutputAnchorByCommodity[commodity] = Math.max(0, remainingAnchor);
  }
  if (redirectedAnchor > 0) {
    nominalOutputAnchorByCommodity[input.outputCommodity] =
      (nominalOutputAnchorByCommodity[input.outputCommodity] ?? 0) + redirectedAnchor;
  }

  const outputUnitsByCommodity: Partial<Record<CommodityType, number>> = {};
  for (const [commodity, nominalAnchor] of Object.entries(nominalOutputAnchorByCommodity) as Array<
    [CommodityType, number]
  >) {
    const basePrice = input.basePrices[commodity] ?? 0;
    if (basePrice > 0 && nominalAnchor > 0) {
      outputUnitsByCommodity[commodity] = nominalAnchor / basePrice;
    }
  }

  return {
    nominalOutputAnchorByCommodity,
    outputUnitsByCommodity,
    inputThroughputShare: allocationShare,
  };
}

/** Uses live per-commodity sector quality plus a bounded contribution from paid development. */
export function productQualityForCommodity(input: {
  currentSectorQuality: number | null | undefined;
  paidDevelopmentAnchor: number;
  paidThresholdAnchor: number;
  stage: ManufacturingLifecycleStage;
}): number {
  const liveQuality = clamp(
    typeof input.currentSectorQuality === "number" && Number.isFinite(input.currentSectorQuality)
      ? input.currentSectorQuality
      : 0,
    0,
    100
  );
  const threshold = finiteNonNegative(input.paidThresholdAnchor);
  const paidRatio =
    threshold > 0 ? clamp(finiteNonNegative(input.paidDevelopmentAnchor) / threshold, 0, 1) : 0;
  const paidContribution = MAX_PAID_DEVELOPMENT_QUALITY * paidRatio;
  return clamp(liveQuality + paidContribution * QUALITY_STAGE_FACTOR[input.stage], 0, 100);
}
