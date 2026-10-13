/** Open-market quotes apply quality premiums and optional cost-plus pricing; group units use the benchmark. */
import { costPlusPriceFactor } from "../costPlusPricing/rules";
export const QUALITY_PREMIUM_REF = 50;
/** Slope: how far a full-scale quality swing (0…100) moves the premium multiplier. */
export const QUALITY_PREMIUM_STRENGTH = 0.3;
export const QUALITY_PREMIUM_MULT_MIN = 0.5;
export const QUALITY_PREMIUM_MULT_MAX = 1.5;

/**
 * Multiplier applied to a positive pricing posture given the seller's output
 * quality (0–100). 1.0 at neutral quality; > 1 rewards a premium brand, < 1
 * penalizes a premium on low quality. Clamped to keep the effect bounded.
 * Returns 1 (no effect) for non-finite quality.
 */
export function qualityPremiumMultiplier(quality: number): number {
  if (!Number.isFinite(quality)) return 1;
  const raw =
    1 + (QUALITY_PREMIUM_STRENGTH * (quality - QUALITY_PREMIUM_REF)) / QUALITY_PREMIUM_REF;
  return Math.max(QUALITY_PREMIUM_MULT_MIN, Math.min(QUALITY_PREMIUM_MULT_MAX, raw));
}

export function offerPriceFactor(input: {
  posture: number;
  priceLeg: number;
  qualityPremiumEnabled?: boolean;
  quality?: number | null;
  inputCostIndex?: number;
  inputCostShare?: number;
  fixedCostShare?: number;
}): number {
  const mult =
    input.qualityPremiumEnabled && input.posture > 0 && input.quality != null
      ? qualityPremiumMultiplier(input.quality)
      : 1;
  const premium = input.posture > 0 ? input.posture * mult : input.posture;
  return input.inputCostIndex !== undefined
    ? costPlusPriceFactor(input.inputCostIndex, premium, input.inputCostShare, input.fixedCostShare)
    : (1 + premium) * input.priceLeg;
}
