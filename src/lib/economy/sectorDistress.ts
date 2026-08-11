import type { Db } from "mongodb";
import { SECTOR_SUPPLY } from "@/lib/constants/commodities";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

export interface SectorDistressScore {
  sectorType: CorporationType;
  distress: number;
  rank: number;
}

/**
 * Scores each sector type by economic distress using global commodity prices.
 * Higher score = more distressed = receives a larger auto-seed boost.
 *
 * Formula per sector:
 *   output_price_ratio = weighted_avg(globalPrice / basePrice) over SECTOR_SUPPLY commodities
 *   supply_demand_ratio = weighted_avg(globalSupply / globalDemand), capped 0.1–10
 *   distress = 0.6 * (output_price_ratio - 1) + 0.4 * (1 / supply_demand_ratio - 1)
 *
 * output_price_ratio > 1 means outputs are expensive (high demand, should grow).
 * supply_demand_ratio < 1 means shortage (production lagging demand, should grow).
 */
export async function computeSectorDistressRanking(db: Db): Promise<SectorDistressScore[]> {
  const commodityPrices = await db.collection<CommodityPrice>("commodityPrices").find({}).toArray();

  const priceMap = new Map(commodityPrices.map((c) => [c.commodity, c]));

  const scores: { sectorType: CorporationType; distress: number }[] = [];

  for (const sectorType of CORPORATION_TYPES) {
    const supplyFlows = SECTOR_SUPPLY[sectorType] ?? [];

    if (supplyFlows.length === 0) {
      scores.push({ sectorType, distress: 0 });
      continue;
    }

    let priceRatioWeighted = 0;
    let sdRatioWeighted = 0;
    let totalRate = 0;

    for (const { commodity, rate } of supplyFlows) {
      const cp = priceMap.get(commodity);
      if (!cp) continue;

      const priceRatio = cp.basePrice > 0 ? cp.globalPrice / cp.basePrice : 1;
      const rawSdRatio = cp.globalDemand > 0 ? cp.globalSupply / cp.globalDemand : 1;
      const sdRatio = Math.min(10, Math.max(0.1, rawSdRatio));

      priceRatioWeighted += priceRatio * rate;
      sdRatioWeighted += sdRatio * rate;
      totalRate += rate;
    }

    if (totalRate === 0) {
      scores.push({ sectorType, distress: 0 });
      continue;
    }

    const outputPriceRatio = priceRatioWeighted / totalRate;
    const sdRatio = sdRatioWeighted / totalRate;
    const distress = 0.6 * (outputPriceRatio - 1) + 0.4 * (1 / sdRatio - 1);

    scores.push({ sectorType, distress });
  }

  scores.sort((a, b) => b.distress - a.distress);

  return scores.map((s, i) => ({ ...s, rank: i }));
}

/**
 * Converts a distress ranking into a per-sector boost multiplier map, scaled by
 * the *magnitude* of each sector's distress (not just its rank).
 *
 * The most-distressed sector receives the full `maxBoost`; every other sector
 * receives `maxBoost × (distress / maxDistress)`, so the spread reflects how
 * distressed each sector actually is rather than forcing an even rank ramp.
 * Sectors with non-positive distress (healthy / oversupplied → should not be
 * stimulated) get 0. If no sector is distressed (`maxDistress ≤ 0`), the whole
 * map is 0 — the economy needs no seeding this run.
 */
export function distressRankingToBoostMap(
  ranking: SectorDistressScore[],
  maxBoost: number
): Map<CorporationType, number> {
  const result = new Map<CorporationType, number>();
  const maxDistress = ranking.reduce((m, r) => Math.max(m, r.distress), 0);
  for (const { sectorType, distress } of ranking) {
    const boost = maxDistress > 0 ? maxBoost * (Math.max(0, distress) / maxDistress) : 0;
    result.set(sectorType, boost);
  }
  return result;
}
