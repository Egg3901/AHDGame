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
 *    commodity divided by ALL buyer demand in the destination state, including
 *    households and unowned production. Sourcing does not identify individual
 *    buyers, so this is a proportional model allocation.
 *  - HAUL REVENUE: proportional to each sector's `freight` commodity supply
 *    share in ALL origin-state supply, including unowned hauliers.
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
   * Charges attributable to noncorporate buyers or missing demand coverage.
   */
  unapportionedCharges: number;
  /**
   * Haul revenue attributable to unowned suppliers or missing supply coverage.
   */
  unapportionedHaulRevenue: number;
}

/**
 * Apportion state-scoped freight charges and haul revenue onto sectors.
 *
 * Both sides are conserving: for every (state, commodity) charge aggregate and
 * every state haul-revenue aggregate, sector shares plus the corresponding
 * noncorporate remainder equal the aggregate. Missing coverage never assigns
 * an entire state's bill or earnings to its sole corporate participant.
 */
export function apportionFreightBilling(inputs: {
  freightChargesByDestState: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  haulRevenueByOriginState: ReadonlyMap<string, number>;
  sectors: readonly FreightBillingSectorUnits[];
  demandUnitsByDestState: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  freightSupplyUnitsByOriginState: ReadonlyMap<string, number>;
}): FreightBillingApportionment {
  const {
    freightChargesByDestState,
    haulRevenueByOriginState,
    sectors,
    demandUnitsByDestState,
    freightSupplyUnitsByOriginState,
  } = inputs;
  const positiveFinite = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

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
      if (!(positiveFinite(charge) > 0)) continue;
      let corporateDemand = 0;
      if (stateSectors) {
        for (const sector of stateSectors) {
          corporateDemand += positiveFinite(sector.demandUnitsByCommodity.get(commodity));
        }
      }
      const stateDemand = positiveFinite(demandUnitsByDestState.get(stateId)?.get(commodity));
      if (!(stateDemand > 0) || !(corporateDemand > 0) || !stateSectors) {
        unapportionedCharges += charge;
        continue;
      }
      // Sector production may grow since the lagged sourcing snapshot. Bound
      // aggregate shares at 100% without shifting noncorporate demand to corps.
      const totalDemand = Math.max(stateDemand, corporateDemand);
      let apportioned = 0;
      for (const sector of stateSectors) {
        const demand = positiveFinite(sector.demandUnitsByCommodity.get(commodity));
        if (!(demand > 0)) continue;
        const share = (charge * demand) / totalDemand;
        chargeBySectorId.set(sector.sectorId, (chargeBySectorId.get(sector.sectorId) ?? 0) + share);
        apportioned += share;
      }
      unapportionedCharges += Math.max(0, charge - apportioned);
    }
  }

  for (const [stateId, revenue] of haulRevenueByOriginState) {
    if (!(positiveFinite(revenue) > 0)) continue;
    const stateSectors = sectorsByState.get(stateId);
    let totalSupply = 0;
    if (stateSectors) {
      for (const sector of stateSectors) {
        totalSupply += positiveFinite(sector.freightSupplyUnits);
      }
    }
    const stateSupply = positiveFinite(freightSupplyUnitsByOriginState.get(stateId));
    if (!(stateSupply > 0) || !(totalSupply > 0) || !stateSectors) {
      unapportionedHaulRevenue += revenue;
      continue;
    }
    totalSupply = Math.max(stateSupply, totalSupply);
    let apportioned = 0;
    for (const sector of stateSectors) {
      const supply = positiveFinite(sector.freightSupplyUnits);
      if (!(supply > 0)) continue;
      const share = (revenue * supply) / totalSupply;
      creditBySectorId.set(sector.sectorId, (creditBySectorId.get(sector.sectorId) ?? 0) + share);
      apportioned += share;
    }
    unapportionedHaulRevenue += Math.max(0, revenue - apportioned);
  }

  return { chargeBySectorId, creditBySectorId, unapportionedCharges, unapportionedHaulRevenue };
}
