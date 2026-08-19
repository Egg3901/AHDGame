/**
 * Freight settlement is the single seam between geographic commodity sourcing
 * and the rest of the market.  It is deliberately pure: the price turn owns
 * persistence and the corporation turn consumes the previous result.
 */

import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { FREIGHT_CLASS_BY_COMMODITY, SHIPPED_COMMODITIES } from "./freightClass";
import { runSourcingPass, type SourcingInputs, type SourcingResult } from "./sourcing";

export interface FreightSettlement {
  /** The auditable route decisions, capacity use and unmet-demand reasons. */
  sourcing: SourcingResult;
  /** Units of each commodity actually available to buyers in a state. */
  deliveredSupplyByCommodity: Map<CommodityType, Map<string, number>>;
  /** Share of a state's requested physical input that the network delivered. */
  inputAvailabilityByCommodity: Map<CommodityType, Map<string, number>>;
  /**
   * The BUY side's mirror: units of a state's own production that found a
   * buyer, `supply - unplaced`. `deliveredSupplyByCommodity` says what a state
   * received; this says what it managed to get rid of.
   *
   * Both halves are needed because the two sides of the market are scoped
   * differently (clearing is country-wide, freight settles state by state),
   * and at t225 that disagreement had 60.4% of world production sitting in a
   * state that did not need it while 28.7% of world demand went unmet.
   */
  placedSupplyByCommodity: Map<CommodityType, Map<string, number>>;
  /**
   * Of the production a state could NOT place, the part that failed because it
   * could not reach a willing buyer rather than because there was none. See
   * `SourcingResult.deliveryLimitedSupplyByState` for the attribution rule.
   *
   * This is the only one of the three that may be shown to a player as a
   * delivery problem. `supply - placed` is not: it also contains plain glut,
   * and telling the owner of a glutted sector to build freight is worse than
   * telling them nothing.
   */
  deliveryLimitedSupplyByCommodity: Map<CommodityType, Map<string, number>>;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Resolve local production first, then use the landed-price freight network
 * for the residual.  The result does not alter the caller's balances.
 */
export function settleFreightNetwork(inputs: SourcingInputs): FreightSettlement {
  const sourcing = runSourcingPass(inputs);
  const deliveredSupplyByCommodity = new Map<CommodityType, Map<string, number>>();
  const inputAvailabilityByCommodity = new Map<CommodityType, Map<string, number>>();

  for (const commodity of SHIPPED_COMMODITIES) {
    const delivered = new Map<string, number>();
    const availability = new Map<string, number>();
    for (const { stateId } of inputs.states) {
      const balance = inputs.byState.get(stateId)?.get(commodity);
      const supply = Math.max(0, balance?.supply ?? 0);
      const demand = Math.max(0, balance?.demand ?? 0);
      delivered.set(stateId, Math.min(supply, demand));
      availability.set(stateId, demand > 0 ? clamp01(Math.min(supply, demand) / demand) : 1);
    }
    deliveredSupplyByCommodity.set(commodity, delivered);
    inputAvailabilityByCommodity.set(commodity, availability);
  }

  // `runSourcingPass` itemizes both domestic and foreign deliveries.  Each is
  // equally real to the buyer; only domestic legs consume local freight supply.
  for (const flow of sourcing.flows) {
    const delivered = deliveredSupplyByCommodity.get(flow.commodity);
    if (!delivered) continue;
    delivered.set(flow.destStateId, (delivered.get(flow.destStateId) ?? 0) + flow.units);
  }

  for (const commodity of SHIPPED_COMMODITIES) {
    const delivered = deliveredSupplyByCommodity.get(commodity)!;
    const availability = inputAvailabilityByCommodity.get(commodity)!;
    for (const { stateId } of inputs.states) {
      const demand = Math.max(0, inputs.byState.get(stateId)?.get(commodity)?.demand ?? 0);
      availability.set(stateId, demand > 0 ? clamp01((delivered.get(stateId) ?? 0) / demand) : 1);
    }
  }

  // Placed supply: what each state's own production managed to sell. The
  // sourcing pass hands back the exact leftover spare, so this is a straight
  // subtraction rather than a sum over `flows` (grid legs lose units in
  // transit, so a flow-side reconstruction never closes).
  const placedSupplyByCommodity = new Map<CommodityType, Map<string, number>>();
  const deliveryLimitedSupplyByCommodity = new Map<CommodityType, Map<string, number>>();
  for (const commodity of COMMODITY_TYPES) {
    const unplaced = sourcing.unplacedSupplyByState.get(commodity);
    const deliveryLimitedByState = sourcing.deliveryLimitedSupplyByState.get(commodity);
    const placed = new Map<string, number>();
    const deliveryLimited = new Map<string, number>();
    // Unshipped commodities (services, and `freight` itself) have no network
    // and never enter the sourcing pass, so there is nothing about them that
    // could be delivery-limited: they are placed in full. NOT capped at local
    // demand, which would be a demand failure wearing a delivery failure's
    // clothes. That is `soldFraction`'s job, and capping here would quietly
    // state-scope the clearing of every service sector.
    const shipped = FREIGHT_CLASS_BY_COMMODITY[commodity] !== null;
    for (const { stateId } of inputs.states) {
      const supply = Math.max(0, inputs.byState.get(stateId)?.get(commodity)?.supply ?? 0);
      placed.set(stateId, shipped ? Math.max(0, supply - (unplaced?.get(stateId) ?? 0)) : supply);
      // Unshipped: no network exists to fail, so the delivery-limited figure is
      // structurally zero rather than merely unmeasured.
      deliveryLimited.set(stateId, shipped ? (deliveryLimitedByState?.get(stateId) ?? 0) : 0);
    }
    placedSupplyByCommodity.set(commodity, placed);
    deliveryLimitedSupplyByCommodity.set(commodity, deliveryLimited);
  }

  return {
    sourcing,
    deliveredSupplyByCommodity,
    inputAvailabilityByCommodity,
    placedSupplyByCommodity,
    deliveryLimitedSupplyByCommodity,
  };
}
