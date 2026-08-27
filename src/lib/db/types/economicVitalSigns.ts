import type { ReconcileStatus } from "@/lib/ledger/types";

export interface EconomicMetric {
  value: number | null;
  observations: number;
  basis: string;
}

export interface RelevantMarketVitalSign {
  commodity: string;
  pooledFillRate: number | null;
  sellerCount: number;
  buyerCount: number;
  sellerHhi: number | null;
  buyerHhi: number | null;
  ownershipAdjustedSellerHhi: number | null;
  ownershipAdjustedBuyerHhi: number | null;
  highConcentrationLowFill: boolean;
}

export interface EconomicVitalSigns {
  _id: string;
  schemaVersion: 1;
  turn: number;
  windowTurns: 48;
  generatedAt: Date;
  goods: {
    pooledFillRate: EconomicMetric;
    countryScopedFillRate: EconomicMetric;
    medianPriceMultiple: EconomicMetric;
    priceScarcityCorrelation: EconomicMetric;
    pooledFillRateWindowMedian: EconomicMetric;
    pooledFillRateRecent12Median: EconomicMetric;
  };
  trade: {
    intentFulfillmentRate: EconomicMetric;
    localShare: EconomicMetric;
    interstateShare: EconomicMetric;
    importShare: EconomicMetric;
    toleranceBoundShareOfUnmet: EconomicMetric;
    capacityBoundShareOfUnmet: EconomicMetric;
    shortageResponsiveShareOfFulfillment: EconomicMetric;
  };
  production: {
    sectorsObserved: number;
    throughputFloorShare: EconomicMetric;
    physicalSellThrough: EconomicMetric;
    labourStaffingRate: EconomicMetric;
    chronicLowFillShare: EconomicMetric;
    stockpilingShare: EconomicMetric;
  };
  firms: {
    listings: number;
    marketCapitalizationAnchor: number;
    revenueAnchor: number;
    incomeAnchor: number;
    lossMakingShare: EconomicMetric;
    marketCapHhi: EconomicMetric;
    topFourMarketCapShare: EconomicMetric;
  };
  competition: {
    markets: RelevantMarketVitalSign[];
    medianSellerHhi: EconomicMetric;
    medianBuyerHhi: EconomicMetric;
    medianOwnershipAdjustedSellerHhi: EconomicMetric;
    medianOwnershipAdjustedBuyerHhi: EconomicMetric;
    highConcentrationLowFillShare: EconomicMetric;
  };
  securities: {
    equityTrades48Turns: number;
    equityNotionalAnchor48Turns: number;
    activeTradedListingShare: EconomicMetric;
    activeBonds: number;
    noHolderBondShare: EconomicMetric;
    medianBondHolders: EconomicMetric;
    bondSubscriptionRate: EconomicMetric;
    openBuyOrders: number;
    openSellOrders: number;
    twoSidedListingShare: EconomicMetric;
    medianQuotedSpreadPct: EconomicMetric;
    openOrderDepthAnchor: number;
    depthToMarketCap: EconomicMetric;
    medianFilledOrderExecutionHours: EconomicMetric;
    medianAmihudIlliquidity48: EconomicMetric;
  };
  households: {
    householdsObserved: number;
    aggregateWealthAnchor: number;
    medianWealthAnchor: EconomicMetric;
    wealthGini: EconomicMetric;
    topTenWealthShare: EconomicMetric;
  };
  money: {
    currenciesObserved: number;
    medianAnnualizedM2GrowthPct: EconomicMetric;
    medianInflationPct: EconomicMetric;
    moneyGrowthInflationCorrelation: EconomicMetric;
    creditToM2: EconomicMetric;
    transactionalMoneyShare: EconomicMetric;
    externalBroadMoneyShare: EconomicMetric;
    bankDepositShare: EconomicMetric;
    activeModeledBalanceShare48: EconomicMetric;
    dormantModeledBalanceShare48: EconomicMetric;
    modeledGrossVelocity48: EconomicMetric;
    householdGrossVelocity48: EconomicMetric;
    corporateGrossVelocity48: EconomicMetric;
    partyGrossVelocity48: EconomicMetric;
    governmentGrossVelocity48: EconomicMetric;
  };
  measurement: {
    confidence: "low" | "medium" | "high";
    reasons: string[];
  };
  reconciliation: {
    status: ReconcileStatus | "unavailable";
    trialBalanceUnbalancedCount: number | null;
    stockVsFlowDivergentCount: number | null;
    moneySupplyFindingCount: number | null;
  };
}
