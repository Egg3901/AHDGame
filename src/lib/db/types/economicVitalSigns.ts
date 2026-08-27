import type { ReconcileStatus } from "@/lib/ledger/types";

export interface EconomicMetric {
  value: number | null;
  observations: number;
  basis: string;
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
  securities: {
    equityTrades48Turns: number;
    equityNotionalAnchor48Turns: number;
    activeTradedListingShare: EconomicMetric;
    activeBonds: number;
    noHolderBondShare: EconomicMetric;
    medianBondHolders: EconomicMetric;
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
  };
  reconciliation: {
    status: ReconcileStatus | "unavailable";
    trialBalanceUnbalancedCount: number | null;
    stockVsFlowDivergentCount: number | null;
    moneySupplyFindingCount: number | null;
  };
}
