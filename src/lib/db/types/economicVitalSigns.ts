import type { ReconcileStatus } from "@/lib/ledger/types";
import type { MarketFormationSnapshot } from "./marketFormation";

export interface EconomicMetric {
  value: number | null;
  observations: number;
  basis: string;
}

export interface RelevantMarketVitalSign {
  commodity: string;
  pooledFillRate: number | null;
  supplyUnits: number;
  demandUnits: number;
  priceAnchorPerUnit: number | null;
  participantSellerUnits: number;
  sellerCount: number;
  buyerCount: number;
  sellerHhi: number | null;
  buyerHhi: number | null;
  ownershipAdjustedSellerHhi: number | null;
  ownershipAdjustedBuyerHhi: number | null;
  largestOwnershipAdjustedSellerShare: number | null;
  largestOwnershipAdjustedSellerUnits: number | null;
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
  marketFormation: MarketFormationSnapshot;
  securities: {
    equityTrades48Turns: number;
    equityNotionalAnchor48Turns: number;
    activeTradedListingShare: EconomicMetric;
    activeBonds: number;
    noHolderBondShare: EconomicMetric;
    sovereignNoHolderBondShare: EconomicMetric;
    corporateNoHolderBondShare: EconomicMetric;
    medianBondHolders: EconomicMetric;
    bondSubscriptionRate: EconomicMetric;
    sovereignMedianHolders: EconomicMetric;
    sovereignSubscriptionRate: EconomicMetric;
    sovereignMaturityHhi: EconomicMetric;
    sovereignMedianPriceToParSpreadPct: EconomicMetric;
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
  /** How much of the 48 turn window actually produced a snapshot, and which turns did not. */
  coverage: {
    /** Earliest turn in the window that has a snapshot. The series may be younger than the window. */
    coverageStartTurn: number;
    windowTurnsExpected: number;
    windowTurnsObserved: number;
    windowCoverageShare: number | null;
    missingTurns: number[];
  };
  /** Rolling 12 turn medians so a spiky single turn cannot anchor a review baseline. */
  securitiesRecent12: {
    depthToMarketCapMedian: EconomicMetric;
    twoSidedListingShareMedian: EconomicMetric;
    activeTradedListingShareMedian: EconomicMetric;
    sovereignNoHolderBondShareMedian: EconomicMetric;
  };
  measurement: {
    confidence: "low" | "medium" | "high";
    reasons: string[];
  };
  reconciliation: {
    status: ReconcileStatus | "unavailable";
    trialBalanceUnbalancedCount: number | null;
    /** null when the stock-vs-flow check was skipped: unknown, not zero. */
    stockVsFlowDivergentCount: number | null;
    stockVsFlowSkipped: boolean | null;
    moneySupplyFindingCount: number | null;
  };
}
