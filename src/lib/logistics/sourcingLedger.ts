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
  /**
   * State buyer intents before era calibration, resolved through reachable
   * sellers, landed-price tolerance, and freight capacity.
   */
  basis: "buyer_intent_sourcing";
  commodity: CommodityType;
  turn: number;
  /** Full buyer-intent denominator: all delivered legs plus `unmetUnits`. */
  demandUnitsIntent: number;
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
  /**
   * Canonical freight billing v1 (gameConfig.canonicalFreightBillingEnabled):
   * per destination state, per commodity, the shipping money buyers there owe
   * for accepted domestic hauls, rounded to 2 decimals. Only written while the
   * flag is on; absent otherwise, so a world with billing off persists nothing
   * new. The corporation turn reads it one turn lagged, like landedPremiums.
   */
  freightCharges?: Record<string, Partial<Record<CommodityType, number>>>;
  /**
   * The transfer's other half: per origin state, the shipping money its
   * freight network earned, rounded to 2 decimals. Same gate and cadence as
   * `freightCharges`.
   */
  freightHaulRevenue?: Record<string, number>;
  /**
   * Phase 4 freight ramp indicator: the active ramp fraction R in [0,1] applied
   * this turn to the sales cap and billing money. Written whenever the ramp is
   * mid-flight (0 < R < 1) so the markets tracker and admin view can show the
   * phase-in explicitly; absent when unramped (R == 1, full effect or off).
   */
  freightSettlementRampFraction?: number;
  createdAt: Date;
}

export function buildSourcingDocs(
  result: SourcingResult,
  turn: number,
  now: Date,
  options?: {
    /**
     * gameConfig.canonicalFreightBillingEnabled. Off (the default) writes no
     * billing fields at all — the aggregates exist only inside the pure pass.
     */
    includeFreightBilling?: boolean;
    /**
     * Phase 4 freight ramp: scale the persisted billing money (charge AND haul
     * revenue) by this fraction [0,1] so the shipping bill fades in with the
     * sales cap. Both sides scale by the same factor, so the charge/credit
     * conservation the corp-turn apportionment relies on is preserved. Default
     * 1 (unramped, byte-identical to before).
     */
    billingRampFraction?: number;
  }
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
      basis: "buyer_intent_sourcing",
      commodity: s.commodity,
      turn,
      demandUnitsIntent:
        Math.round((s.intraStateUnits + s.interStateUnits + s.importUnits + s.unmetUnits) * 100) /
        100,
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
    // grid rides no haulage capacity, so it is always 0 here and is not a
    // reason to keep an otherwise idle state in the ledger.
    if (used.bulk <= 0 && used.special <= 0) continue;
    freightTeuByState[stateId] = {
      bulk: Math.round(used.bulk * 100) / 100,
      special: Math.round(used.special * 100) / 100,
      grid: 0,
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

  const networkDoc: SourcingNetworkDoc = {
    turn,
    freightTeuByState,
    landedPremiums,
    importAggregates,
    createdAt: now,
  };

  if (options?.includeFreightBilling) {
    // Ramp fraction scales both the charge and the haul-revenue side by the
    // same factor, preserving their conservation. Clamped defensively; default 1.
    const rampScale = Math.max(0, Math.min(1, options.billingRampFraction ?? 1));
    const freightCharges: Record<string, Partial<Record<CommodityType, number>>> = {};
    for (const [stateId, byCommodity] of result.freightChargesByDestState) {
      const perCommodity: Partial<Record<CommodityType, number>> = {};
      for (const [commodity, charge] of byCommodity) {
        const rounded = Math.round(charge * rampScale * 100) / 100;
        if (rounded <= 0) continue;
        perCommodity[commodity] = rounded;
      }
      if (Object.keys(perCommodity).length > 0) freightCharges[stateId] = perCommodity;
    }
    const freightHaulRevenue: Record<string, number> = {};
    for (const [stateId, revenue] of result.haulRevenueByOriginState) {
      const rounded = Math.round(revenue * rampScale * 100) / 100;
      if (rounded <= 0) continue;
      freightHaulRevenue[stateId] = rounded;
    }
    networkDoc.freightCharges = freightCharges;
    networkDoc.freightHaulRevenue = freightHaulRevenue;
  }

  return { commodityDocs, networkDoc };
}
