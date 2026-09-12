import { COMMODITY_PRICE_DRIFT_RATE, computeMarketPrice } from "@/lib/constants/commodities";
import { attributeCommodityPrice, type CommodityPriceAttribution } from "./priceAttribution";

export interface GlobalCommodityPriceResult {
  appliedPrice: number;
  effectiveBasePrice: number;
  attribution: CommodityPriceAttribution;
}

/** Resolve the existing global price formula and its exact additive explanation. */
export function computeGlobalCommodityPrice(args: {
  realBasePrice: number;
  nominalIndex: number;
  scarcityMultiplier: number;
  costPassThroughMultiplier: number;
  supply: number;
  demand: number;
  priceKnee: number;
  previousPrice?: number;
  hardPeg?: number;
  nudge?: number;
}): GlobalCommodityPriceResult {
  const nominalBasePrice = args.realBasePrice * args.nominalIndex;
  const scarcityAdjustedBasePrice = nominalBasePrice * args.scarcityMultiplier;
  const effectiveBasePrice =
    Math.round(scarcityAdjustedBasePrice * args.costPassThroughMultiplier * 100) / 100;
  const marketTargetPrice = computeMarketPrice(
    effectiveBasePrice,
    args.supply,
    args.demand,
    args.priceKnee
  );
  const previousPrice = args.previousPrice ?? marketTargetPrice;
  const driftedPrice =
    Math.round(
      (previousPrice + COMMODITY_PRICE_DRIFT_RATE * (marketTargetPrice - previousPrice)) * 100
    ) / 100;
  const appliedPrice = args.hardPeg ?? args.nudge ?? driftedPrice;

  return {
    appliedPrice,
    effectiveBasePrice,
    attribution: attributeCommodityPrice({
      realBasePrice: args.realBasePrice,
      nominalBasePrice,
      scarcityAdjustedBasePrice,
      effectiveBasePrice,
      marketTargetPrice,
      driftedPrice,
      appliedPrice,
    }),
  };
}
