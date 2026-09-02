import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import type { ReachableBookEntry } from "@/lib/trade/reachableBook";
import { reachableDemandGap } from "@/lib/trade/reachableBook";

export type CommodityMarketScope = "reachable" | "state";

export const STATE_SCOPED_COMMODITIES = COMMODITY_TYPES.filter(
  (commodity) => commodityMarketScope(commodity) === "state"
);

type Balance = { supply: number; demand: number };

/**
 * The physical market in which one commodity can be sold.
 *
 * Most commodities clear in the widest book their producer can reach. Freight
 * is different: one unit is haulage capacity based in an origin state, not
 * cargo that can itself be shipped to another market. Its supply and the haul
 * demand consuming it therefore belong to the same state book.
 */
export function commodityMarketScope(commodity: CommodityType): CommodityMarketScope {
  return commodity === "freight" ? "state" : "reachable";
}

export function isStateScopedCommodity(commodity: CommodityType): boolean {
  return commodityMarketScope(commodity) === "state";
}

/** Corporation-wide agreements cannot represent a market with state identity. */
export function supportsCorporationWideSupplyAgreement(commodity: CommodityType): boolean {
  return !isStateScopedCommodity(commodity);
}

/**
 * A state-scoped commodity can still be contracted, but only as a state-scoped
 * agreement: the contract names the state whose book it is fulfilled in.
 */
export function supplyAgreementRequiresState(commodity: CommodityType): boolean {
  return isStateScopedCommodity(commodity);
}

/**
 * Key under which one agreement's volume is reserved, cleared, delivered and
 * settled. Corporation-wide agreements key on the commodity alone, so every
 * existing map keyed by `CommodityType` keeps working unchanged. A state-scoped
 * agreement keys on `commodity@stateId`, which keeps a Texas freight contract
 * from reserving New York haulage or being credited with it.
 */
export function supplyAgreementScopeKey(commodity: CommodityType, stateId?: string | null): string {
  return stateId ? `${commodity}@${stateId}` : commodity;
}

/** Inverse of {@link supplyAgreementScopeKey}. */
export function parseSupplyAgreementScopeKey(key: string): {
  commodity: CommodityType;
  stateId?: string;
} {
  const at = key.indexOf("@");
  if (at < 0) return { commodity: key as CommodityType };
  return { commodity: key.slice(0, at) as CommodityType, stateId: key.slice(at + 1) };
}

/**
 * Buyers' room for a commodity, using the same physical scope as clearing.
 *
 * State-local commodities fail closed when their state balance is missing. An
 * aggregate fallback would let an unlocated seller claim demand already used
 * by correctly located state books. Reachable commodities retain the existing
 * world fallback for pre-snapshot worlds.
 */
export function commodityDemandGap(args: {
  commodity: CommodityType;
  stateBalance?: Balance;
  reachableBook?: ReachableBookEntry;
  globalBalance?: Balance;
}): number {
  if (isStateScopedCommodity(args.commodity)) {
    return args.stateBalance ? Math.max(0, args.stateBalance.demand - args.stateBalance.supply) : 0;
  }
  if (args.reachableBook) return reachableDemandGap(args.reachableBook);
  return Math.max(0, (args.globalBalance?.demand ?? 0) - (args.globalBalance?.supply ?? 0));
}
