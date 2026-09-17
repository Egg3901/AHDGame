/** Exact additive explanation of one applied global commodity price. */
export interface CommodityPriceAttribution {
  appliedPrice: number;
  realBasePrice: number;
  nominalInflation: number;
  scarcityMemory: number;
  producerInputCostPassThrough: number;
  marketBalance: number;
  adjustmentLag: number;
  explicitOverride: number;
}

export function attributeCommodityPrice(args: {
  realBasePrice: number;
  nominalBasePrice: number;
  scarcityAdjustedBasePrice: number;
  effectiveBasePrice: number;
  marketTargetPrice: number;
  driftedPrice: number;
  appliedPrice: number;
}): CommodityPriceAttribution {
  const {
    realBasePrice,
    nominalBasePrice,
    scarcityAdjustedBasePrice,
    effectiveBasePrice,
    marketTargetPrice,
    driftedPrice,
    appliedPrice,
  } = args;

  return {
    appliedPrice,
    realBasePrice,
    nominalInflation: nominalBasePrice - realBasePrice,
    scarcityMemory: scarcityAdjustedBasePrice - nominalBasePrice,
    producerInputCostPassThrough: effectiveBasePrice - scarcityAdjustedBasePrice,
    marketBalance: marketTargetPrice - effectiveBasePrice,
    adjustmentLag: driftedPrice - marketTargetPrice,
    explicitOverride: appliedPrice - driftedPrice,
  };
}
