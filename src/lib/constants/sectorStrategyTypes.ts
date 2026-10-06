import type { CommodityType } from "./commodities";
import type { MediaOperatingModelId } from "@/lib/mediaOperatingModels/catalog";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Number of turns for the linear transition between strategies */
export const STRATEGY_TRANSITION_TURNS = 12;

/** Cooldown turns from initiation before another strategy change is allowed */
export const STRATEGY_COOLDOWN_TURNS = 24;

/** Fraction of daily revenue charged when initiating a strategy change */
export const STRATEGY_RETOOL_COST_FRACTION = 0.25;

/** Margin penalty (percentage points) applied while a transition is in progress */
export const STRATEGY_TRANSITION_MARGIN_PENALTY = -5;

/** Fraction of daily revenue charged when cancelling a transition mid-flight (scales with progress) */
export const CANCEL_COST_FRACTION = 0.1;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SectorStrategy {
  id: string;
  name: string;
  description: string;
  supply: Partial<Record<CommodityType, number>>;
  demand: Partial<Record<CommodityType, number>>;
  /**
   * Sector tech-tree gating (v2). When the tech-trees feature is on:
   *  - `minDecade`: the world must have reached this decade (id, e.g. "2009").
   *  - `requiresTechUnlock`: the corp must have unlocked this strategy via a
   *    tech node carrying `unlockStrategy: <this id>`.
   * Both may apply. Absent ⇒ always available (legacy / baseline methods).
   * See lib/constants/techTree/strategyAvailability.
   */
  minDecade?: string;
  requiresTechUnlock?: boolean;
  /** Present on virtual strategy definitions backed by the media model catalog. */
  mediaOperatingModelId?: MediaOperatingModelId;
}

export interface EffectiveStrategyRates {
  supply: Partial<Record<CommodityType, number>>;
  demand: Partial<Record<CommodityType, number>>;
  /** True when a transition is actively in progress (−5% margin penalty applies) */
  isTransitioning: boolean;
}
