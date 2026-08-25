/**
 * Canonical freight billing v1 (issue #897, markets plan Phase 4): apportion
 * the sourcing pass's per-state shipping money onto the corps that owe and
 * earn it.
 *
 * The sourcing pass settles freight state by state, so its money aggregates
 * are state-scoped: `freightChargesByDestState` is what buyers in a state
 * collectively owe for inbound hauls, `haulRevenueByOriginState` is what that
 * state's freight network earned. This module splits both across sectors:
 *
 *  - CHARGES: proportional to each sector's input demand units of the charged
 *    commodity in the destination state. Sourcing is state-scoped, so every
 *    unit of a state's demand carries the same imported share; demand units
 *    are therefore an exact proxy for imported input consumption.
 *  - HAUL REVENUE: proportional to each sector's `freight` commodity supply
 *    share in the origin state, the same book whose capacity the pass consumed.
 *
 * Pure by design, like the sourcing pass itself: the corporation turn owns
 * persistence. Apportionment is conserving; whatever cannot be attributed (a
 * charged state where no sector demands the commodity, an earning state with
 * no freight-supplying sector) is returned as an unapportioned remainder
 * rather than silently smeared or dropped, so
 *   sum(sector shares) + unapportioned == state aggregate
 * holds exactly on both sides.
 */

import type { CommodityType } from "@/lib/constants/commodities";

/** One sector's billing-relevant physical units, keyed into its host state. */
export interface FreightBillingSectorUnits {
  sectorId: string;
  stateId: string;
  /**
   * The sector's per-commodity input demand units this turn
   * (`computeSectorCommodityUnits().demand`). Only commodities present in the
   * state's charge aggregate are read.
   */
  demandUnitsByCommodity: ReadonlyMap<CommodityType, number>;
  /** The sector's `freight` commodity supply units this turn. */
  freightSupplyUnits: number;
}

export interface FreightBillingApportionment {
  /** Shipping cost owed per sector id. Sectors owing nothing are absent. */
  chargeBySectorId: Map<string, number>;
  /** Haul revenue earned per sector id. Sectors earning nothing are absent. */
  creditBySectorId: Map<string, number>;
  /**
   * Charges in states where no sector demanded the charged commodity, so no
   * buyer could be attributed. Zero when every charge found its buyers.
   */
  unapportionedCharges: number;
  /**
   * Haul revenue in states with no freight-supplying sector. Zero when every
   * earning state has at least one logistics supplier.
   */
  unapportionedHaulRevenue: number;
}

/**
 * Apportion state-scoped freight charges and haul revenue onto sectors.
 *
 * Both sides are conserving: for every (state, commodity) charge aggregate and
 * every state haul-revenue aggregate, the sum of the sector shares equals the
 * aggregate exactly (floating point aside), or the whole aggregate lands in
 * the matching unapportioned remainder when no sector qualifies.
 */
export function apportionFreightBilling(inputs: {
  freightChargesByDestState: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  haulRevenueByOriginState: ReadonlyMap<string, number>;
  sectors: readonly FreightBillingSectorUnits[];
}): FreightBillingApportionment {
  const { freightChargesByDestState, haulRevenueByOriginState, sectors } = inputs;

  const sectorsByState = new Map<string, FreightBillingSectorUnits[]>();
  for (const sector of sectors) {
    let list = sectorsByState.get(sector.stateId);
    if (!list) {
      list = [];
      sectorsByState.set(sector.stateId, list);
    }
    list.push(sector);
  }

  const chargeBySectorId = new Map<string, number>();
  const creditBySectorId = new Map<string, number>();
  let unapportionedCharges = 0;
  let unapportionedHaulRevenue = 0;

  for (const [stateId, byCommodity] of freightChargesByDestState) {
    const stateSectors = sectorsByState.get(stateId);
    for (const [commodity, charge] of byCommodity) {
      if (!(charge > 0)) continue;
      let totalDemand = 0;
      if (stateSectors) {
        for (const sector of stateSectors) {
          totalDemand += Math.max(0, sector.demandUnitsByCommodity.get(commodity) ?? 0);
        }
      }
      if (!(totalDemand > 0) || !stateSectors) {
        unapportionedCharges += charge;
        continue;
      }
      for (const sector of stateSectors) {
        const demand = Math.max(0, sector.demandUnitsByCommodity.get(commodity) ?? 0);
        if (!(demand > 0)) continue;
        const share = (charge * demand) / totalDemand;
        chargeBySectorId.set(sector.sectorId, (chargeBySectorId.get(sector.sectorId) ?? 0) + share);
      }
    }
  }

  for (const [stateId, revenue] of haulRevenueByOriginState) {
    if (!(revenue > 0)) continue;
    const stateSectors = sectorsByState.get(stateId);
    let totalSupply = 0;
    if (stateSectors) {
      for (const sector of stateSectors) {
        totalSupply += Math.max(0, sector.freightSupplyUnits);
      }
    }
    if (!(totalSupply > 0) || !stateSectors) {
      unapportionedHaulRevenue += revenue;
      continue;
    }
    for (const sector of stateSectors) {
      const supply = Math.max(0, sector.freightSupplyUnits);
      if (!(supply > 0)) continue;
      const share = (revenue * supply) / totalSupply;
      creditBySectorId.set(sector.sectorId, (creditBySectorId.get(sector.sectorId) ?? 0) + share);
    }
  }

  return { chargeBySectorId, creditBySectorId, unapportionedCharges, unapportionedHaulRevenue };
}
