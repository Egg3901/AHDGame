import type { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporationType, OperatingSectorType } from "@/lib/constants/corporations";
import {
  getOperatingSectorType,
  SECTOR_STRATEGIES,
  STRATEGY_COOLDOWN_TURNS,
} from "@/lib/constants/sectorStrategies";
import { getStrategyAvailability } from "@/lib/constants/techTree/strategyAvailability";
import { retoolRescaleFields } from "@/lib/corporations/retoolRescale";
import type { CommodityPriceRatioFn } from "@/lib/turn/npp/marketSignals";
import { isObsoleteNppParentStrategy } from "./rules/obsoleteStrategyRepair";
import { unknownRetainedCostPlusCommodities } from "@/lib/market/producerMarket/retainedQuoteRules";

function hasUnsupportedRetainedCostPlusStock(
  sector: CorporateSector,
  strategy: { supply: Partial<Record<CommodityType, number>> }
): boolean {
  const finalOutputCommodities = Object.entries(strategy.supply)
    .filter(([, units]) => typeof units === "number" && units > 0)
    .map(([commodity]) => commodity);
  return (
    unknownRetainedCostPlusCommodities({
      outputStock: sector.producerInventory?.outputStock ?? [],
      finalOutputCommodities,
      quotes: sector.producerQuotes,
    }).length > 0
  );
}

/** Effective profit margin at or below which a sector is a shift candidate. */
export const STRATEGY_SHIFT_MARGIN_TRIGGER = -3;
/** Required price-score advantage over the current strategy. */
export const STRATEGY_SHIFT_MIN_ADVANTAGE = 0.08;
/** High bar for a profitable sector to retool toward a shortage. */
export const STRATEGY_SHIFT_PROFIT_SEEK_ADVANTAGE = 0.25;

/**
 * Price advantage per anchor unit of revenue. Positive scores favor recipes
 * that sell into expensive markets and buy from cheap ones. Returns null when
 * no commodity on either side has a price ratio.
 */
export function strategyPriceScore(
  strategy: {
    supply: Partial<Record<CommodityType, number>>;
    demand: Partial<Record<CommodityType, number>>;
  },
  countryId: string,
  priceRatioOf: CommodityPriceRatioFn
): number | null {
  let score = 0;
  let priced = false;
  for (const [commodity, rate] of Object.entries(strategy.supply)) {
    if (!(typeof rate === "number" && rate > 0)) continue;
    const ratio = priceRatioOf(commodity as CommodityType, countryId);
    if (ratio == null) continue;
    score += rate * (ratio - 1);
    priced = true;
  }
  for (const [commodity, rate] of Object.entries(strategy.demand)) {
    if (!(typeof rate === "number" && rate > 0)) continue;
    const ratio = priceRatioOf(commodity as CommodityType, countryId);
    if (ratio == null) continue;
    score -= rate * (ratio - 1);
    priced = true;
  }
  return priced ? score : null;
}

export interface StrategyRetoolDecision {
  sectorId: ObjectId;
  updates: Record<string, unknown>;
}

interface StrategyRetoolContext {
  corp: Corporation;
  sectors: readonly CorporateSector[];
  divestedSectorIds: readonly ObjectId[];
  turn: number;
  now: Date;
  currentYear: number;
  techTreesEnabled: boolean;
  plantsEnabled: boolean;
  priceRatioOf: CommodityPriceRatioFn;
}

/**
 * Selects at most one running sector whose reachable recipe has a material
 * price advantage, then returns the complete transition write for that sector.
 */
export function chooseNppStrategyRetool(ctx: StrategyRetoolContext): StrategyRetoolDecision | null {
  let best: {
    sector: CorporateSector;
    toStrategyId: string;
    advantage: number;
    corrective?: true;
  } | null = null;

  for (const sector of ctx.sectors) {
    if (sector.mothballed === true) continue;
    if (ctx.divestedSectorIds.includes(sector._id)) continue;
    if (sector.sectorType === "extraction") continue;
    if (
      typeof sector.transitionCooldownUntilTurn === "number" &&
      sector.transitionCooldownUntilTurn > ctx.turn
    ) {
      continue;
    }
    if (sector.transitionFromStrategyId) continue;

    const operatingType = getOperatingSectorType(
      sector.sectorType,
      sector.industryModel,
      sector.mediaDiscriminator
    );
    const strategies = SECTOR_STRATEGIES[operatingType as OperatingSectorType];
    if (!strategies || strategies.length < 2) continue;
    const countryId = sector.countryId ?? ctx.corp.countryId;
    const currentId = sector.strategyId ?? "standard";
    const current = strategies.find((strategy) => strategy.id === currentId);
    if (!current) {
      if (
        !best?.corrective &&
        isObsoleteNppParentStrategy(ctx.corp.ceoType, operatingType, currentId)
      ) {
        const standard = strategies.find((strategy) => strategy.id === "standard");
        if (
          standard &&
          !getStrategyAvailability(ctx.corp, standard, ctx.currentYear, ctx.techTreesEnabled)
            .locked &&
          !hasUnsupportedRetainedCostPlusStock(sector, standard)
        ) {
          // Keep the obsolete source id throughout the normal blend. Replacing
          // its fallback immediately would change paid capacity's unit basis.
          best = { sector, toStrategyId: standard.id, advantage: 0, corrective: true };
        }
      }
      continue;
    }
    if (best?.corrective) continue;
    const currentScore = strategyPriceScore(current, countryId, ctx.priceRatioOf);
    if (currentScore == null) continue;

    const distressed = (sector.effectiveProfitMargin ?? 0) <= STRATEGY_SHIFT_MARGIN_TRIGGER;
    for (const candidate of strategies) {
      if (candidate.id === currentId) continue;
      const availability = getStrategyAvailability(
        ctx.corp,
        candidate,
        ctx.currentYear,
        ctx.techTreesEnabled
      );
      if (availability.locked) continue;
      if (hasUnsupportedRetainedCostPlusStock(sector, candidate)) continue;
      const score = strategyPriceScore(candidate, countryId, ctx.priceRatioOf);
      if (score == null) continue;
      const advantage = score - currentScore;
      const requiredAdvantage = distressed
        ? STRATEGY_SHIFT_MIN_ADVANTAGE
        : STRATEGY_SHIFT_PROFIT_SEEK_ADVANTAGE;
      if (advantage < requiredAdvantage) continue;
      if (best == null || advantage > best.advantage) {
        best = { sector, toStrategyId: candidate.id, advantage };
      }
    }
  }

  if (!best) return null;
  const fromStrategyId = best.sector.strategyId ?? "standard";
  return {
    sectorId: best.sector._id,
    updates: {
      strategyId: best.toStrategyId,
      transitionFromStrategyId: fromStrategyId,
      transitionStartTurn: ctx.turn,
      transitionCooldownUntilTurn: ctx.turn + STRATEGY_COOLDOWN_TURNS,
      ...retoolRescaleFields({
        sectorType: best.sector.sectorType as CorporationType,
        industryModel: best.sector.industryModel,
        mediaDiscriminator: best.sector.mediaDiscriminator,
        fromStrategyId,
        toStrategyId: best.toStrategyId,
        plantsEnabled: ctx.plantsEnabled,
        capitalStock: best.sector.capitalStock,
        buildQueue: best.sector.buildQueue,
        otherOpexPerUnitAnchor: best.sector.otherOpexPerUnitAnchor,
      }),
      updatedAt: ctx.now,
    },
  };
}
