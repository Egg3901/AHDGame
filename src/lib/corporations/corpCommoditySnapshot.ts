/**
 * Per-turn commodity output snapshot for corporation history charts.
 * Physical output units only — global supply share is derived at read time
 * from `commodityFlows.supplyUnits` for the same turn.
 *
 * The derivation is `computeSectorCommodityUnits`, shared with the Commodities
 * tab, so a corp's charted history and its live tab report the same production
 * (ticket #1177).
 */

import type { CommodityType } from "@/lib/constants/commodities";
import {
  computeSectorCommodityUnits,
  type CorpCommodityFlowContext,
  type FlowSector,
} from "@/lib/corporations/corpCommodityFlows";

type SnapshotSector = Omit<FlowSector, "stateId"> & { stateId?: FlowSector["stateId"] };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Sum physical output units per commodity across a corporation's sectors.
 * Pure — no DB access.
 */
export function buildCommodityOutputSnapshot(
  sectors: SnapshotSector[],
  currentTurn: number,
  context: CorpCommodityFlowContext = {}
): Record<string, number> {
  const totals = new Map<CommodityType, number>();

  for (const sector of sectors) {
    const { supply } = computeSectorCommodityUnits(
      { ...sector, stateId: sector.stateId ?? "" },
      currentTurn,
      context
    );
    for (const [commodity, units] of supply) {
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
