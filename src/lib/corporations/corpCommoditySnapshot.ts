/**
 * Per-turn commodity output snapshot for corporation history charts.
 * Physical output units only — global supply share is derived at read time
 * from `commodityFlows.supplyUnits` for the same turn.
 */

import type { CorporateSector } from "@/lib/db/types";
import {
  COMMODITY_BASE_PRICES,
  dollarsToUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

type SnapshotSector = Pick<
  CorporateSector,
  "sectorType" | "revenue" | "strategyId" | "transitionFromStrategyId" | "transitionStartTurn"
>;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Sum physical output units per commodity across a corporation's sectors.
 * Pure — no DB access.
 */
export function buildCommodityOutputSnapshot(
  sectors: SnapshotSector[],
  currentTurn: number
): Record<string, number> {
  const totals = new Map<CommodityType, number>();

  for (const sector of sectors) {
    const rates = getEffectiveStrategyRates(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      currentTurn
    );
    for (const [commodity, rate] of Object.entries(rates.supply) as [CommodityType, number][]) {
      if (!rate || rate <= 0) continue;
      const basePrice = COMMODITY_BASE_PRICES[commodity];
      if (!(basePrice > 0)) continue;
      const units = dollarsToUnits(sector.revenue * rate, basePrice);
      totals.set(commodity, (totals.get(commodity) ?? 0) + units);
    }
  }

  const out: Record<string, number> = {};
  for (const [commodity, units] of totals) {
    if (units <= 0) continue;
    out[commodity] = round2(units);
  }
  return out;
}

/** Corp output ÷ global supply × 100, capped at 100. */
export function computeCommodityOutputSharePercent(
  outputUnits: number,
  globalSupplyUnits: number
): number {
  if (!(outputUnits > 0) || !(globalSupplyUnits > 0)) return 0;
  return Math.round(Math.min(100, (outputUnits / globalSupplyUnits) * 100) * 100) / 100;
}
