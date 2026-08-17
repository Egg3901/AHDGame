// src/lib/turn/npp/strategyExpectedRevenue.ts
/**
 * Expected-realized-revenue scoring for NPP extraction strategy choice
 * (market-structural week 1, t899 misallocation remediation).
 *
 * The prior brain picked strategies from global scarcity alone, so NPP miners
 * strategized into resources their state physically cannot extract (e.g. iron
 * desired 15.3M in a state with capacity 1,222) while huge deposits sat idle.
 * This scorer prices in BOTH the market signal and what the state can support:
 *
 *   score = Σ_outputs( rate × laggedPriceRatio(commodity) × capacityHeadroom(resource) )
 *
 * where laggedPriceRatio is the host country's reachable book over basePrice
 * (national, then global fallback; last turn's prices) and
 * capacityHeadroom ∈ [0, 1] is the state's remaining idle fraction of the
 * resource's capacity (1 for uncapped/legacy states and non-extractable
 * outputs). A strategy whose primary resource has no local headroom scores ~0
 * regardless of how scarce the commodity is globally — which is exactly the
 * misallocation bug.
 *
 * Pure functions only; the DB wiring lives in
 * `src/lib/turn/extractionAutoStrategy.ts` (NPP re-strategize pass) and rides
 * behind the same `gameState.extractionAutoStrategyEnabled` flag.
 */

import {
  EXTRACTABLE_RESOURCES,
  type CommodityType,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Best candidate must beat the current strategy's score by this margin. */
export const STRATEGY_SWITCH_MIN_IMPROVEMENT = 0.25;

/**
 * Lagged soldFraction below this = chronic low fill (mirrors the clearing
 * autoPosture cut threshold): the sector can't sell what it already makes, so
 * re-strategizing toward higher expected revenue is preferred over expanding
 * output, and the switch margin relaxes.
 */
export const CHRONIC_LOW_FILL_THRESHOLD = 0.35;

/** Relaxed switch margin under chronic low fill. */
export const LOW_FILL_SWITCH_MIN_IMPROVEMENT = 0.1;

/**
 * A candidate's primary resource must have more than this fraction of state
 * capacity idle to be switched INTO. Guards against strategizing onto an
 * exhausted or nonexistent deposit.
 */
export const MIN_PRIMARY_HEADROOM_FRACTION = 0.02;

/** Scores below this are treated as "effectively zero" (dead strategy). */
const SCORE_EPSILON = 1e-9;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Last turn's reachable/national/global price over basePrice, or null when unpriced. */
export type LaggedPriceRatioFn = (commodity: CommodityType) => number | null;

/**
 * Remaining idle fraction of the sector's state capacity for a resource,
 * in [0, 1]. Return 1 for uncapped/legacy states (no capacity document),
 * 0 when the state has no deposit or it is fully utilized.
 */
export type CapacityHeadroomFn = (resource: ExtractableResource) => number;

export interface StrategySwitchDecision {
  /** Strategy to switch to. */
  strategyId: string;
  currentScore: number;
  bestScore: number;
}

type ScorableStrategy = Pick<SectorStrategy, "id" | "supply">;

// ─── Scoring ────────────────────────────────────────────────────────────────

function isExtractable(commodity: string): commodity is ExtractableResource {
  return (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity);
}

/**
 * Expected realized revenue per unit of sector scale for one strategy:
 * price signal × what the state can physically support, summed over outputs.
 * Unpriced commodities contribute at a neutral ratio of 1.
 */
export function scoreStrategyExpectedRevenue(
  supply: Partial<Record<CommodityType, number>>,
  priceRatioOf: LaggedPriceRatioFn,
  headroomOf: CapacityHeadroomFn
): number {
  let score = 0;
  for (const [commodity, rate] of Object.entries(supply) as [CommodityType, number][]) {
    if (!rate || rate <= 0) continue;
    const ratio = priceRatioOf(commodity);
    const priceSignal = ratio != null && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    const headroom = isExtractable(commodity) ? Math.min(1, Math.max(0, headroomOf(commodity))) : 1;
    score += rate * priceSignal * headroom;
  }
  return score;
}

/** The extractable resource a strategy produces at the highest rate, or null. */
export function primaryExtractionResource(strategy: ScorableStrategy): ExtractableResource | null {
  let best: ExtractableResource | null = null;
  let bestRate = 0;
  for (const resource of EXTRACTABLE_RESOURCES) {
    const rate = strategy.supply[resource] ?? 0;
    if (rate > bestRate) {
      best = resource;
      bestRate = rate;
    }
  }
  return best;
}

// ─── Switch decision ────────────────────────────────────────────────────────

/**
 * Decide whether a sector should switch extraction strategy, by expected
 * realized revenue. Returns the winning strategy or null to stay put.
 *
 * Rules:
 * - Every strategy is scored: Σ rate × laggedPriceRatio × capacityHeadroom.
 * - A candidate whose PRIMARY resource has ~zero local headroom is never
 *   switched into (the t899 misallocation bug).
 * - The best candidate must beat the current score by
 *   STRATEGY_SWITCH_MIN_IMPROVEMENT (relaxed to LOW_FILL_SWITCH_MIN_IMPROVEMENT
 *   under chronic low fill) — except when the current strategy scores ~0
 *   (dead deposit), where any positive candidate wins.
 *
 * Cooldown/transition eligibility is the caller's responsibility (it lives on
 * the sector document, not in this pure helper).
 */
export function decideExtractionStrategySwitch(params: {
  currentStrategyId: string;
  strategies: readonly ScorableStrategy[];
  priceRatioOf: LaggedPriceRatioFn;
  headroomOf: CapacityHeadroomFn;
  /** Lagged soldFraction from the sector doc (clearing mode); null/undefined when absent. */
  soldFraction?: number | null;
}): StrategySwitchDecision | null {
  const { currentStrategyId, strategies, priceRatioOf, headroomOf, soldFraction } = params;
  if (strategies.length === 0) return null;

  const current =
    strategies.find((s) => s.id === currentStrategyId) ??
    strategies.find((s) => s.id === "standard") ??
    strategies[0];
  const currentScore = strategies.some((s) => s.id === currentStrategyId)
    ? scoreStrategyExpectedRevenue(current.supply, priceRatioOf, headroomOf)
    : 0; // unknown/legacy strategy id → treat as yielding nothing

  let best: { strategy: ScorableStrategy; score: number } | null = null;
  for (const strategy of strategies) {
    if (strategy.id === currentStrategyId) continue;
    // Never switch INTO a strategy whose primary resource has no local headroom.
    const primary = primaryExtractionResource(strategy);
    if (primary && headroomOf(primary) <= MIN_PRIMARY_HEADROOM_FRACTION) continue;
    const score = scoreStrategyExpectedRevenue(strategy.supply, priceRatioOf, headroomOf);
    if (score <= SCORE_EPSILON) continue;
    if (!best || score > best.score) best = { strategy, score };
  }
  if (!best) return null;

  const chronicLowFill = soldFraction != null && soldFraction < CHRONIC_LOW_FILL_THRESHOLD;
  const minImprovement = chronicLowFill
    ? LOW_FILL_SWITCH_MIN_IMPROVEMENT
    : STRATEGY_SWITCH_MIN_IMPROVEMENT;
  const required =
    currentScore <= SCORE_EPSILON ? SCORE_EPSILON : currentScore * (1 + minImprovement);
  if (best.score <= required) return null;

  return { strategyId: best.strategy.id, currentScore, bestScore: best.score };
}
