import { ATTACK_OWNED_COST_FRACTION, SPLIT_COST_FRACTION } from "@/lib/constants/corporations";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CurrencyCode } from "@/lib/constants/currencies";

export function calculateAttackCostAnchor(targetRevenueAnchor: number): number {
  return Math.round(Math.max(0, targetRevenueAnchor) * ATTACK_OWNED_COST_FRACTION);
}

export function calculateAttackCostFromLocalRevenue(
  targetRevenueLocal: number,
  currencyCode: CurrencyCode | string | null | undefined,
  fxRate: number
): number {
  return calculateAttackCostAnchor(
    readCorpEconomicAnchor(targetRevenueLocal, currencyCode, fxRate)
  );
}

export function calculateSplitCostAnchor(unownedRevenueAnchor: number): number {
  return Math.round(Math.max(0, unownedRevenueAnchor) * SPLIT_COST_FRACTION);
}

export function calculateSplitMsCost(splitEscalation: number | null | undefined): number {
  return Math.pow(2, Math.max(0, splitEscalation ?? 0));
}

export type SplitSize = "small" | "normal" | "large";

export const SPLIT_SIZE_MULTIPLIERS: Record<SplitSize, number> = {
  small: 0.5,
  normal: 1.0,
  large: 2.0,
};

export type SplitStrength = "full" | "half";

export const SPLIT_STRENGTH_MULTIPLIERS: Record<SplitStrength, number> = {
  full: 1.0,
  half: 0.5,
};

/**
 * MS cost adjusted for split size.
 * Small splits cost half MS (min 1); large splits cost 2×; normal is unchanged.
 */
export function calculateSplitMsCostForSize(
  splitEscalation: number | null | undefined,
  size: SplitSize
): number {
  const base = calculateSplitMsCost(splitEscalation);
  if (size === "small") return Math.max(1, Math.floor(base * 0.5));
  if (size === "large") return base * 2;
  return base;
}

/**
 * MS cost adjusted for split strength.
 * Half strength costs half MS (min 1); full strength is unchanged.
 */
export function calculateSplitMsCostForStrength(
  splitEscalation: number | null | undefined,
  strength: SplitStrength
): number {
  const base = calculateSplitMsCost(splitEscalation);
  if (strength === "half") return Math.max(1, Math.floor(base * 0.5));
  return base;
}
