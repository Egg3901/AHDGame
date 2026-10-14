/**
 * Commodity treadmill fix: six staged corrections advanced one per turn via
 * `gameConfig.commodityFixStage` (0 = none, 6 = all, verified).
 *
 * Why staged: on the 1991 world (prod t179) demand was defined as a multiple
 * of last turn's supply (household and government caps at 1.5x prior supply,
 * retail at 1 + GDP growth x 15). Every unit of new capacity raised the next
 * turn's demand by 1.5 to 1.7 units, unmet share sat pinned near a third, and
 * the scarcity ratchet integrated that pinned residual into a permanent 2x
 * price that stepped up every turn since turn 1. Each stage below removes one
 * link of that loop. The applied price only moves 6%/turn toward target, so
 * no stage steps revenue; each is a pure function of the stage number and
 * reverts alone by lowering the number.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";

export const COMMODITY_FIX_STAGE = {
  /** Scarcity ratchet integrates CHANGE in imbalance, not its level. */
  RATCHET_MOMENTUM: 1,
  /** Retail GDP demand amplifier scale 15 -> 5, clamp 2.0 -> 1.3. */
  RETAIL_AMPLIFIER: 2,
  /** Household and government supply caps 1.5x -> 1.25x prior supply. */
  DEMAND_CAPS: 3,
  /** Extra production-policy output headroom where the sector's own output is short. */
  SHORTAGE_POLICY_HEADROOM: 4,
  /** Extractable stock cover cap 400 -> 96 turns (timber glut). */
  EXTRACTABLE_STOCK_COVER: 5,
  /** Verification turn, no engine change. */
  VERIFY: 6,
} as const;

export const COMMODITY_FIX_STAGE_MAX = COMMODITY_FIX_STAGE.VERIFY;

/** Normalise a raw config value to an integer stage in [0, 6]. */
export function normalizeCommodityFixStage(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(COMMODITY_FIX_STAGE_MAX, Math.trunc(raw)));
}

export function commodityFixStageActive(
  stage: number | null | undefined,
  atLeast: number
): boolean {
  return normalizeCommodityFixStage(stage) >= atLeast;
}

/** Stage 2: retail GDP amplifier parameters. */
export const RETAIL_GDP_DEMAND_SCALE_STAGED = 5;
export const RETAIL_GDP_MULTIPLIER_MAX_STAGED = 1.3;

export interface RetailGdpParams {
  scale: number;
  max: number;
}

export function retailGdpParamsForStage(
  stage: number | null | undefined,
  defaults: RetailGdpParams
): RetailGdpParams {
  return commodityFixStageActive(stage, COMMODITY_FIX_STAGE.RETAIL_AMPLIFIER)
    ? { scale: RETAIL_GDP_DEMAND_SCALE_STAGED, max: RETAIL_GDP_MULTIPLIER_MAX_STAGED }
    : defaults;
}

/** Stage 3: shared household/government ceiling as a multiple of prior supply. */
export const DEMAND_SUPPLY_CAP_STAGED = 1.25;

export function demandSupplyCapForStage(
  stage: number | null | undefined,
  defaultCap: number
): number {
  return commodityFixStageActive(stage, COMMODITY_FIX_STAGE.DEMAND_CAPS)
    ? DEMAND_SUPPLY_CAP_STAGED
    : defaultCap;
}

/**
 * Stage 4: a plant at positive production policy whose OWN output clears into
 * a market more than `SHORTAGE_HEADROOM_UNMET_THRESHOLD` unmet gets up to
 * `SHORTAGE_HEADROOM_MAX_BONUS` extra output (and input draw, the recipe book
 * is closed) on top of the standard +15% at policy +25. Returns a factor >= 1
 * that scales BOTH the output and input policy multipliers.
 */
export const SHORTAGE_HEADROOM_UNMET_THRESHOLD = 0.25;
export const SHORTAGE_HEADROOM_MAX_BONUS = 0.1;

export function shortagePolicyHeadroom(args: {
  stage: number | null | undefined;
  policyLevel: number;
  /** Output rates of the sector (commodity -> rate). */
  supplyRates: Partial<Record<CommodityType, number>> | null | undefined;
  /** Lagged balances of the book the sector sells into. */
  balances: ReadonlyMap<CommodityType, { supply: number; demand: number }> | null | undefined;
}): number {
  const { stage, policyLevel, supplyRates, balances } = args;
  if (!commodityFixStageActive(stage, COMMODITY_FIX_STAGE.SHORTAGE_POLICY_HEADROOM)) return 1;
  if (!(policyLevel > 0) || !supplyRates || !balances) return 1;
  let rateSum = 0;
  let weightedUnmet = 0;
  for (const [commodity, rate] of Object.entries(supplyRates) as [CommodityType, number][]) {
    if (!(rate > 0)) continue;
    const bal = balances.get(commodity);
    const unmet = bal && bal.demand > 0 ? Math.max(0, bal.demand - bal.supply) / bal.demand : 0;
    rateSum += rate;
    weightedUnmet += rate * unmet;
  }
  if (!(rateSum > 0)) return 1;
  const unmetShare = weightedUnmet / rateSum;
  if (unmetShare <= SHORTAGE_HEADROOM_UNMET_THRESHOLD) return 1;
  const severity = Math.min(
    1,
    (unmetShare - SHORTAGE_HEADROOM_UNMET_THRESHOLD) / (1 - SHORTAGE_HEADROOM_UNMET_THRESHOLD)
  );
  const levelShare = Math.min(1, policyLevel / 25);
  return 1 + SHORTAGE_HEADROOM_MAX_BONUS * severity * levelShare;
}

/** Stage 5: extractable stock cover cap in turns of demand. */
export const EXTRACTABLE_STOCK_COVER_CAP_TURNS = 96;

export function stockCoverCapTurnsForStage(
  stage: number | null | undefined,
  commodity: CommodityType,
  defaultTurns: number
): number {
  if (!commodityFixStageActive(stage, COMMODITY_FIX_STAGE.EXTRACTABLE_STOCK_COVER)) {
    return defaultTurns;
  }
  return (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity)
    ? EXTRACTABLE_STOCK_COVER_CAP_TURNS
    : defaultTurns;
}
