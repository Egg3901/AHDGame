import type { ReconcileStatus, StockVsFlowByKind } from "@/lib/ledger/types";
import type { MarketFormationSnapshot } from "./marketFormation";
import type { SovereignDemandGapReason } from "@/lib/bonds/sovereignIssueDiagnostics";

export interface EconomicMetric {
  value: number | null;
  observations: number;
  basis: string;
}

/**
 * Per-country sovereign issuance rollup (#1001): the issue-level diagnostics
 * grouped so a country-local allocator gap shows up as a cross-section.
 * Plain data, computed from the same bond inputs as the aggregate securities
 * section; additive and safe for older snapshots to omit.
 */
export interface SovereignCountryIssuanceSnapshot {
  countryId: string;
  issueCount: number;
  unheldIssueCount: number;
  noHolderShare: number;
  subscriptionRate: number;
  medianHolders: number;
  medianSpreadToParPct: number;
  maturityHhi: number;
  thinIssueCount: number;
  /**
   * Demand-gap cross-section (#1001): unheld issues by primary exclusion
   * reason (`no_domestic_fund`, `capital_controls`, `cash_buffer`, ...).
   * Counts sum to `unheldIssueCount`. Absent when the snapshot was computed
   * without fund demand inputs, so older snapshots keep reading identically.
   */
  demandGapByReason?: Partial<Record<SovereignDemandGapReason, number>>;
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
    /** Commodities whose recorded demand the 1.5x caps cut this turn (#1460). */
    demandTruncatedCommodities: EconomicMetric;
    /** Worst (demand + truncated) / supply among capped commodities (#1460). */
    maxLatentShortageMultiple: EconomicMetric;
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
    corporateMedianHolders: EconomicMetric;
    corporateSubscriptionRate: EconomicMetric;
    sovereignMaturityHhi: EconomicMetric;
    corporateMaturityHhi: EconomicMetric;
    sovereignMedianPriceToParSpreadPct: EconomicMetric;
    sovereignIssuanceByCountry?: SovereignCountryIssuanceSnapshot[];
    /** Median discount to par across unmatured corporate issues; the corporate mirror of the sovereign spread. */
    corporateMedianPriceToParSpreadPct: EconomicMetric;
    openBuyOrders: number;
    openSellOrders: number;
    twoSidedListingShare: EconomicMetric;
    /**
     * The liquidity facility posts both sides itself, so it meets the plain two-sided and
     * depth measures by construction. These exclude its quotes and show participation.
     */
    facilityQuotedListings: number;
    organicTwoSidedListingShare: EconomicMetric;
    medianQuotedSpreadPct: EconomicMetric;
    openOrderDepthAnchor: number;
    depthToMarketCap: EconomicMetric;
    organicDepthToMarketCap: EconomicMetric;
    medianFilledOrderExecutionHours: EconomicMetric;
    medianAmihudIlliquidity48: EconomicMetric;
    /**
     * Median across traded listings of the largest named counterparty's share
     * of that listing's 48-turn economic trade notional. Float-only and
     * non-economic rows are unattributable, so they narrow the sample instead
     * of reading as dispersed trading.
     */
    medianTopTraderNotionalShare48: EconomicMetric;
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
    /** Rows on the current observation contract (growth-comparable in principle). */
    currentAccountingCurrencies: number;
    /** Rows with a finite same-version growth reading this turn. */
    comparableGrowthCurrencies: number;
    /** Observation contract version per currency code; null on legacy observations. */
    observationVersions: Record<string, number | null>;
    /**
     * Growth comparability per currency code: high = comparable reading,
     * medium = current method but still warming up, low = legacy/unversioned.
     */
    observationConfidence: Record<string, "high" | "medium" | "low">;
    /** Bond-pool settlement inventory excluded from observed M2 (#2021). */
    excludedBondPoolCash: EconomicMetric;
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
    /** Wallet (`character`) turnover over wallet closing stock; null when the class is absent. */
    householdTransactionalVelocity48: EconomicMetric;
    /** Savings (`character_savings`) turnover over savings closing stock; null when absent. */
    householdSavingsVelocity48: EconomicMetric;
    /** Savings share of household (`character` + `character_savings`) closing stock. */
    savingsShareOfHouseholdBalances: EconomicMetric;
    corporateGrossVelocity48: EconomicMetric;
    partyGrossVelocity48: EconomicMetric;
    governmentGrossVelocity48: EconomicMetric;
    /** Turnover over closing balances for pooled vehicles (fund, org, npp legs). */
    intermediatedGrossVelocity48: EconomicMetric;
    /**
     * Ring-fenced bank cash reserves in anchor, summed over reporting active
     * charters. Null when active charters exist but none reports reserves, so
     * an unclassified stock never reads as zero. Outside the shadow ledger:
     * neither stock-checked nor part of the modeled velocity denominators.
     */
    bankCashReservesAnchor: EconomicMetric;
    /**
     * Nonnegative share-escrow balances in anchor. Absent means instant
     * settlement mode, which holds no escrow, so empty reads as zero rather
     * than unknown. Negative rows are buyback debt, not money, and are floored
     * per row like the modeled balance stocks.
     */
    escrowCashAnchor: EconomicMetric;
    /**
     * Ring-fenced (bank plus escrow) share of ledger-backed plus ring-fenced
     * closing stock. Null without a balance snapshot, with an incomplete bank
     * classification, or on a non-positive denominator: a stated allocation
     * ratio must never rest on a partial stock.
     */
    ringFencedShareOfLiquid: EconomicMetric;
    /**
     * Persisted null seam: bank accounts emit no ledger legs, so no
     * authoritative 48-turn turnover exists for the bank holder class. The
     * numerator is unavailable, not zero; estimating it from unrelated flows
     * would manufacture a velocity.
     */
    bankGrossVelocity48: EconomicMetric;
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
    corporateNoHolderBondShareMedian: EconomicMetric;
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
    /**
     * Per-kind stock-vs-flow inventory (ranked by unexplained ₳), copied from
     * the reconciliation report. null when the check was skipped or no
     * reconciliation ran: unknown, not zero. Survives the report's findings
     * cap because it is computed pre-cap (#992).
     */
    stockVsFlowByKind: StockVsFlowByKind[] | null;
  };
}
