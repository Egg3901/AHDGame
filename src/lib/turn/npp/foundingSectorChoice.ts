/**
 * Sector choice for an NPP founding a new corporation.
 *
 * Founding used to pick a sector uniformly at random. Across a run that spread
 * new companies evenly over all sectors whatever the market needed, on top of a
 * seed that already gives every country one company per sector. In the 1991
 * world the result was a market whose sector mix ignored where the shortages
 * and profits were.
 *
 * The choice is now weighted: a sector whose outputs are short in the founder's
 * market (the same price-ratio signal expansion uses) is more likely, and a
 * sector already crowded with companies in that country is less likely. Every
 * sector keeps a floor weight, so founding stays varied.
 *
 * A sector one firm dominates is also pulled up (see rules/sectorConcentration):
 * a new company there is a rival the sector lacks. The caller passes the boost;
 * it is 1 everywhere else.
 *
 * Pure: no database, clock or randomness. The caller passes one uniform roll.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import { sectorPeakShortageScore, type CommodityPriceRatioFn } from "./marketSignals";

/** Lowest shortage score a sector is treated as having, so no sector reaches zero weight. */
export const FOUNDING_MIN_SHORTAGE_SCORE = 0.5;
/** Weight grows with the square of the shortage score: a 2x-priced output is 4x as attractive. */
export const FOUNDING_SHORTAGE_EXPONENT = 2;

export function foundingSectorWeights(args: {
  types: readonly CorporationType[];
  countryId: string;
  priceRatioOf: CommodityPriceRatioFn;
  existingCount: (countryId: string, type: CorporationType) => number;
  /** Multiplier for a concentrated sector; absent reads as 1. */
  challengerBoostOf?: (type: CorporationType) => number;
}): number[] {
  return args.types.map((type) => {
    const raw = sectorPeakShortageScore(type, args.countryId, args.priceRatioOf);
    const score = Math.max(FOUNDING_MIN_SHORTAGE_SCORE, Number.isFinite(raw) && raw > 0 ? raw : 1);
    const crowding = 1 + Math.max(0, args.existingCount(args.countryId, type));
    const boost = Math.max(1, args.challengerBoostOf?.(type) ?? 1);
    return (Math.pow(score, FOUNDING_SHORTAGE_EXPONENT) / crowding) * boost;
  });
}

/** Index chosen by one uniform roll in [0, 1) over non-negative weights. */
export function pickWeightedIndex(weights: readonly number[], roll: number): number {
  const total = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!(total > 0)) return Math.min(weights.length - 1, Math.floor(roll * weights.length));
  let target = roll * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] > 0 ? weights[i] : 0;
    if (target < w) return i;
    target -= w;
  }
  return weights.length - 1;
}

/** A market priced at or above this multiple of base counts as short. */
export const FOUNDING_SHORT_PRICE_RATIO = 1.15;
/** Foundings one sweep may complete with no shortage, and the extra a fully short world adds. */
export const FOUNDING_SWEEP_CAP_FLOOR = 3;
export const FOUNDING_SWEEP_CAP_EXTRA = 9;
/** Founding chance is multiplied by 1 + this * pressure (1x calm, 3x fully short). */
export const FOUNDING_CHANCE_PRESSURE_GAIN = 2;

/** Share of priced markets running short, in [0, 1]; unpriced markets are ignored. */
export function foundingShortagePressure(ratios: readonly (number | null)[]): number {
  let priced = 0;
  let short = 0;
  for (const ratio of ratios) {
    if (ratio == null || !Number.isFinite(ratio)) continue;
    priced++;
    if (ratio >= FOUNDING_SHORT_PRICE_RATIO) short++;
  }
  return priced > 0 ? short / priced : 0;
}

/** Per-sweep ceiling on completed foundings: bounded, but wider when markets are short. */
export function foundingSweepCap(pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  return FOUNDING_SWEEP_CAP_FLOOR + Math.round(FOUNDING_SWEEP_CAP_EXTRA * p);
}

export function foundingChanceMultiplier(pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  return 1 + FOUNDING_CHANCE_PRESSURE_GAIN * p;
}
