import type { CommodityType } from "@/lib/constants/commodities";
import type { FreightClass } from "./freightClass";

type Balance = { supply: number; demand: number };

/**
 * Book the sourcing pass's consumed haul TEU as freight demand (ticket #1039).
 *
 * The TEU an origin state's network hauled is real freight consumption, so it
 * enters all three levels the market reads before clearing: byState (state
 * price legs + the stored stateDemand the Logistics map shows), byCountry
 * (trade clearing + national legs; aggregated from byState before the sourcing
 * pass runs, so it needs its own add), and global (price + sold %). Haul TEU
 * and freight supply share the era unit basis. Freight is never itself shipped
 * (FREIGHT_CLASS_BY_COMMODITY.freight = null), so this cannot feed back into
 * the same pass; higher freight prices damp next turn's haul via shipping
 * cost, a lagged negative feedback. Money still does not move (interstate
 * logistics plan step 5); shipping stays unbilled to buyers.
 */
export function applyFreightHaulDemand(
  freightTeuByState: ReadonlyMap<string, Record<FreightClass, number>>,
  balances: {
    global: Map<CommodityType, Balance>;
    byState: Map<string, Map<CommodityType, Balance>>;
    byCountry: Map<string, Map<CommodityType, Balance>>;
    stateToCountry: ReadonlyMap<string, string>;
  }
): void {
  const { global, byState, byCountry, stateToCountry } = balances;
  const globalBal = global.get("freight");
  for (const [stateId, used] of freightTeuByState) {
    const haulTeu = used.bulk + used.special;
    if (haulTeu <= 0) continue;
    const stateBal = byState.get(stateId)?.get("freight");
    if (stateBal) stateBal.demand += haulTeu;
    if (globalBal) globalBal.demand += haulTeu;
    const countryId = stateToCountry.get(stateId);
    const countryBal = countryId ? byCountry.get(countryId)?.get("freight") : undefined;
    if (countryBal) countryBal.demand += haulTeu;
  }
}

export type FreightDemandEntry = {
  /** Origin-state interstate haul TEU (shadow ledger). */
  bulk: number;
  special: number;
  /** bulk + special haul load. */
  total: number;
  /** Freight commodity supply in this state (TEU capacity logistics clear against). */
  capacity: number;
};
