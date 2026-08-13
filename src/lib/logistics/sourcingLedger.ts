/**
 * Persistence shape for the record-only sourcing pass. One doc per
 * {commodity, turn} in `commoditySourcingFlows`, mirroring the
 * `commodityFlows` upsert/prune pattern but at state granularity, so a
 * shorter retention window caps the extra volume (plan open question 8).
 */

import type { CommodityType } from "@/lib/constants/commodities";
import type { FreightClass } from "./freightClass";
import type { SourcingFlow, SourcingResult } from "./sourcing";

/** 1 game year — state-level rows are ~50× denser than country rows. */
export const SOURCING_FLOW_RETENTION_TURNS = 48;

/** Itemized flows per commodity doc are capped largest-first; totals stay exact. */
export const SOURCING_FLOW_MAX_ITEMIZED = 200;

export interface CommoditySourcingDoc {
  commodity: CommodityType;
  turn: number;
  intraStateUnits: number;
  interStateUnits: number;
  importUnits: number;
  tariffPaid: number;
  unmetUnits: number;
  toleranceBoundUnits: number;
  capacityBoundUnits: number;
  /** Largest flows first, capped at SOURCING_FLOW_MAX_ITEMIZED. */
  flows: Omit<SourcingFlow, "commodity">[];
  itemizedFlowCount: number;
  totalFlowCount: number;
  createdAt: Date;
}

export interface SourcingNetworkDoc {
  turn: number;
  /** Per-state freight consumed this turn, by class — network load for the UI. */
  freightTeuByState: Record<string, Record<FreightClass, number>>;
  /**
   * Per destination state, per commodity: premiumPerUnit = extraCost / metUnits,
   * rounded to 4 decimals. Omits entries where metUnits <= 0 or the premium
   * rounds to <= 0. This is the one-turn-lagged surcharge money wiring reads
   * for out-of-state sourcing.
   */
  landedPremiums: Record<string, Record<CommodityType, number>>;
  /** Per buyer country: tariff paid and import value, rounded to 2 decimals. Omits zero entries. */
  importAggregates: Record<string, { tariffPaid: number; importValue: number }>;
  createdAt: Date;
}

export function buildSourcingDocs(
  result: SourcingResult,
  turn: number,
  now: Date
): { commodityDocs: CommoditySourcingDoc[]; networkDoc: SourcingNetworkDoc } {
  const flowsByCommodity = new Map<CommodityType, SourcingFlow[]>();
  for (const flow of result.flows) {
    let list = flowsByCommodity.get(flow.commodity);
    if (!list) {
      list = [];
      flowsByCommodity.set(flow.commodity, list);
    }
    list.push(flow);
  }

  const commodityDocs: CommoditySourcingDoc[] = result.summaries.map((s) => {
    const all = flowsByCommodity.get(s.commodity) ?? [];
    const itemized = [...all]
      .sort((a, b) => b.units - a.units)
      .slice(0, SOURCING_FLOW_MAX_ITEMIZED)
      .map(({ commodity: _commodity, ...rest }) => rest);
    return {
      commodity: s.commodity,
      turn,
      intraStateUnits: s.intraStateUnits,
      interStateUnits: s.interStateUnits,
      importUnits: s.importUnits,
      tariffPaid: s.tariffPaid,
      unmetUnits: s.unmetUnits,
      toleranceBoundUnits: s.toleranceBoundUnits,
      capacityBoundUnits: s.capacityBoundUnits,
      flows: itemized,
      itemizedFlowCount: itemized.length,
      totalFlowCount: all.length,
      createdAt: now,
    };
  });

  const freightTeuByState: Record<string, Record<FreightClass, number>> = {};
  for (const [stateId, used] of result.freightTeuByState) {
    if (used.bulk <= 0 && used.special <= 0) continue;
    freightTeuByState[stateId] = {
      bulk: Math.round(used.bulk * 100) / 100,
      special: Math.round(used.special * 100) / 100,
    };
  }

  const landedPremiums: Record<string, Record<CommodityType, number>> = {};
  for (const [stateId, byCommodity] of result.landedPremiumByDestState) {
    const perCommodity: Partial<Record<CommodityType, number>> = {};
    for (const [commodity, acc] of byCommodity) {
      if (acc.metUnits <= 0) continue;
      const premiumPerUnit = Math.round((acc.extraCost / acc.metUnits) * 10000) / 10000;
      if (premiumPerUnit <= 0) continue;
      perCommodity[commodity] = premiumPerUnit;
    }
    if (Object.keys(perCommodity).length > 0) {
      landedPremiums[stateId] = perCommodity as Record<CommodityType, number>;
    }
  }

  const importAggregates: Record<string, { tariffPaid: number; importValue: number }> = {};
  for (const [countryId, agg] of result.importAggregatesByCountry) {
    const importValue = Math.round(agg.importValue * 100) / 100;
    const tariffPaid = Math.round(agg.tariffPaid * 100) / 100;
    if (importValue <= 0 && tariffPaid <= 0) continue;
    importAggregates[countryId] = { tariffPaid, importValue };
  }

  return {
    commodityDocs,
    networkDoc: { turn, freightTeuByState, landedPremiums, importAggregates, createdAt: now },
  };
}
