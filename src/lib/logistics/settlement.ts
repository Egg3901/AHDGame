/**
 * Freight settlement is the single seam between geographic commodity sourcing
 * and the rest of the market.  It is deliberately pure: the price turn owns
 * persistence and the corporation turn consumes the previous result.
 */

import type { CommodityType } from "@/lib/constants/commodities";
import { SHIPPED_COMMODITIES } from "./freightClass";
import { runSourcingPass, type SourcingInputs, type SourcingResult } from "./sourcing";

export interface FreightSettlement {
  /** The auditable route decisions, capacity use and unmet-demand reasons. */
  sourcing: SourcingResult;
  /** Units of each commodity actually available to buyers in a state. */
  deliveredSupplyByCommodity: Map<CommodityType, Map<string, number>>;
  /** Share of a state's requested physical input that the network delivered. */
  inputAvailabilityByCommodity: Map<CommodityType, Map<string, number>>;
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

  return { sourcing, deliveredSupplyByCommodity, inputAvailabilityByCommodity };
}
