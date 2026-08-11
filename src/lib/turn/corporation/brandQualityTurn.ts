import type { CommodityType } from "@/lib/constants/commodities";
import {
  computeSectorQuality,
  rollupCorpQuality,
  QUALITY_NEUTRAL_INPUT,
} from "@/lib/market/brandQuality";

/**
 * Per-turn quality rollup (four production pillars). Pure.
 *
 * Computes each non-extraction sector's output quality from its corp's tech +
 * operations, its own wage level, and the LAGGED average quality of the
 * commodities it consumes (quality propagation — a corp inherits the quality of
 * its inputs). Rolls up to a revenue-weighted corp averageQuality, and produces
 * the NEW per-commodity average quality (revenue-weighted across every sector
 * that outputs it) for next turn's input lookup.
 *
 * The turn layer supplies lagged commodity quality and persists both rollups.
 */

export interface QualitySectorInput {
  revenueWeight: number;
  wageLevel: number;
  outputs: readonly CommodityType[];
  inputs: readonly CommodityType[];
}

export interface QualityCorpInput {
  corpId: string;
  techScore: number;
  operationsStrength: number;
  sectors: readonly QualitySectorInput[];
}

export interface QualityUpdateResult {
  /** corpId → new averageQuality (0–100); corps with only extraction are omitted. */
  corpQuality: Map<string, number>;
  /** commodity → new average output quality (0–100), for next turn's inputs. */
  commodityQuality: Map<CommodityType, number>;
}

function meanInputQuality(
  inputs: readonly CommodityType[],
  lagged: ReadonlyMap<CommodityType, number>
): number | undefined {
  let n = 0;
  let acc = 0;
  for (const c of inputs) {
    const q = lagged.get(c);
    if (typeof q === "number" && Number.isFinite(q)) {
      acc += q;
      n += 1;
    }
  }
  return n > 0 ? acc / n : undefined;
}

export function computeQualityUpdates(
  corps: readonly QualityCorpInput[],
  laggedCommodityQuality: ReadonlyMap<CommodityType, number>
): QualityUpdateResult {
  const corpQuality = new Map<string, number>();
  // Accumulate revenue-weighted output quality per commodity.
  const commodityAcc = new Map<CommodityType, { w: number; acc: number }>();

  for (const corp of corps) {
    const perSector: { quality: number | null; revenueWeight: number }[] = [];
    for (const sector of corp.sectors) {
      const inputQuality =
        meanInputQuality(sector.inputs, laggedCommodityQuality) ?? QUALITY_NEUTRAL_INPUT;
      const q = computeSectorQuality({
        techScore: corp.techScore,
        wageLevel: sector.wageLevel,
        operationsStrength: corp.operationsStrength,
        inputQuality,
        outputCommodities: sector.outputs,
      });
      perSector.push({ quality: q, revenueWeight: sector.revenueWeight });
      // Feed the per-commodity rollup (only quality-bearing sectors).
      if (q != null) {
        const w = Math.max(0, sector.revenueWeight);
        if (w > 0) {
          for (const c of sector.outputs) {
            const e = commodityAcc.get(c) ?? { w: 0, acc: 0 };
            e.w += w;
            e.acc += w * q;
            commodityAcc.set(c, e);
          }
        }
      }
    }
    const avg = rollupCorpQuality(perSector);
    if (avg != null) corpQuality.set(corp.corpId, avg);
  }

  const commodityQuality = new Map<CommodityType, number>();
  for (const [c, e] of commodityAcc) {
    if (e.w > 0) commodityQuality.set(c, Math.round((e.acc / e.w) * 10) / 10);
  }

  return { corpQuality, commodityQuality };
}
