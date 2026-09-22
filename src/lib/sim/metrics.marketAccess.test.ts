import { describe, expect, it } from "vitest";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import { marketAccessMetricsFromSnapshot } from "./metrics";

const metric = (n: number) => ({ value: n, observations: 1, basis: "test" });

/**
 * The smallest snapshot `marketAccessMetricsFromSnapshot` reads without
 * optional chaining. New tests override only the sections under test, so a
 * partial literal never throws on an unrelated `goods.pooledFillRate` read.
 */
function minimalSnapshot(): Record<string, unknown> {
  return {
    goods: { pooledFillRate: metric(0.6), countryScopedFillRate: metric(0.5) },
    trade: {
      intentFulfillmentRate: metric(0.4),
      localShare: metric(0.7),
      interstateShare: metric(0.2),
      importShare: metric(0.1),
      toleranceBoundShareOfUnmet: metric(0.8),
      capacityBoundShareOfUnmet: metric(0.2),
      shortageResponsiveShareOfFulfillment: metric(0.15),
    },
    production: { physicalSellThrough: metric(0.9), labourStaffingRate: metric(0.55) },
    firms: { marketCapHhi: metric(2500) },
    competition: {
      medianOwnershipAdjustedSellerHhi: metric(3000),
      medianOwnershipAdjustedBuyerHhi: metric(2000),
      highConcentrationLowFillShare: metric(0.4),
    },
    securities: {
      activeTradedListingShare: metric(0.3),
      noHolderBondShare: metric(0.6),
      bondSubscriptionRate: metric(0.4),
      twoSidedListingShare: metric(0.2),
      medianQuotedSpreadPct: metric(5),
      depthToMarketCap: metric(0.01),
      medianFilledOrderExecutionHours: metric(8),
      medianAmihudIlliquidity48: metric(2),
    },
    households: { wealthGini: metric(0.9) },
    money: {
      medianAnnualizedM2GrowthPct: metric(8),
      transactionalMoneyShare: metric(0.3),
      externalBroadMoneyShare: metric(0.4),
      activeModeledBalanceShare48: metric(0.25),
      modeledGrossVelocity48: metric(0.75),
    },
    measurement: { confidence: "high", reasons: [] },
    reconciliation: { status: "green" },
    marketFormation: {
      emptyShare: 0.5,
      facilityReadyEmptyShare: 0.8,
      entryFunnel: { corporationsObserved: 10, entered: 2, explainedOutcomeShare: 1 },
    },
  };
}

describe("marketAccessMetricsFromSnapshot", () => {
  it("returns unavailable values when an older sandbox has no vital-sign snapshot", () => {
    expect(marketAccessMetricsFromSnapshot(null)).toMatchObject({
      pooledFillRate: null,
      intentFulfillmentRate: null,
      householdTransactionalVelocity48: null,
      householdSavingsVelocity48: null,
      savingsShareOfHouseholdBalances: null,
      reconciliationStatus: "unavailable",
      stockVsFlowTotalDivergent: null,
      stockVsFlowTotalAbsDivergence: null,
      stockVsFlowTopKinds: null,
      residentDemandValueAnchor: null,
      localProducerDemandValueAnchor: null,
      localAbsorptionShare: null,
    });
  });

  it("projects comparable terminal measures without changing their bases", () => {
    const value = (n: number) => ({ value: n, observations: 1, basis: "test" });
    const snapshot = {
      goods: { pooledFillRate: value(0.6), countryScopedFillRate: value(0.5) },
      trade: {
        intentFulfillmentRate: value(0.4),
        localShare: value(0.7),
        interstateShare: value(0.2),
        importShare: value(0.1),
        toleranceBoundShareOfUnmet: value(0.8),
        capacityBoundShareOfUnmet: value(0.2),
        shortageResponsiveShareOfFulfillment: value(0.15),
      },
      production: { physicalSellThrough: value(0.9), labourStaffingRate: value(0.55) },
      firms: { marketCapHhi: value(2500) },
      competition: {
        medianOwnershipAdjustedSellerHhi: value(3000),
        medianOwnershipAdjustedBuyerHhi: value(2000),
        highConcentrationLowFillShare: value(0.4),
      },
      securities: {
        activeTradedListingShare: value(0.3),
        noHolderBondShare: value(0.6),
        sovereignNoHolderBondShare: value(0.4),
        corporateNoHolderBondShare: value(0.7),
        bondSubscriptionRate: value(0.4),
        corporateMedianHolders: value(2),
        corporateSubscriptionRate: value(0.35),
        corporateMedianPriceToParSpreadPct: value(2.5),
        corporateMaturityHhi: value(5000),
        twoSidedListingShare: value(0.2),
        medianQuotedSpreadPct: value(5),
        depthToMarketCap: value(0.01),
        medianFilledOrderExecutionHours: value(8),
        medianAmihudIlliquidity48: value(2),
        medianTopTraderNotionalShare48: value(0.7),
      },
      households: { wealthGini: value(0.9) },
      money: {
        medianAnnualizedM2GrowthPct: value(8),
        transactionalMoneyShare: value(0.3),
        externalBroadMoneyShare: value(0.4),
        activeModeledBalanceShare48: value(0.25),
        modeledGrossVelocity48: value(0.75),
        householdTransactionalVelocity48: value(1.2),
        householdSavingsVelocity48: value(0.1),
        savingsShareOfHouseholdBalances: value(0.4),
        bankCashReservesAnchor: value(200),
        ringFencedShareOfLiquid: value(0.4),
      },
      measurement: { confidence: "medium", reasons: ["test"] },
      reconciliation: { status: "amber" },
      marketFormation: {
        emptyShare: 0.5,
        facilityReadyEmptyShare: 0.8,
        entryFunnel: {
          corporationsObserved: 10,
          entered: 2,
          explainedOutcomeShare: 1,
        },
      },
    } as EconomicVitalSigns;

    expect(marketAccessMetricsFromSnapshot(snapshot)).toEqual({
      pooledFillRate: 0.6,
      countryScopedFillRate: 0.5,
      intentFulfillmentRate: 0.4,
      localShare: 0.7,
      interstateShare: 0.2,
      importShare: 0.1,
      toleranceBoundShareOfUnmet: 0.8,
      capacityBoundShareOfUnmet: 0.2,
      shortageResponsiveShareOfFulfillment: 0.15,
      physicalSellThrough: 0.9,
      labourStaffingRate: 0.55,
      marketCapHhi: 2500,
      medianOwnershipAdjustedSellerHhi: 3000,
      medianOwnershipAdjustedBuyerHhi: 2000,
      highConcentrationLowFillShare: 0.4,
      emptyMarketShare: 0.5,
      facilityReadyEmptyMarketShare: 0.8,
      nppMarketEntryRate: 0.2,
      nppEntryOutcomesExplainedShare: 1,
      activeTradedListingShare: 0.3,
      noHolderBondShare: 0.6,
      sovereignNoHolderBondShare: 0.4,
      corporateNoHolderBondShare: 0.7,
      bondSubscriptionRate: 0.4,
      corporateMedianHolders: 2,
      corporateSubscriptionRate: 0.35,
      corporateMedianPriceToParSpreadPct: 2.5,
      corporateMaturityHhi: 5000,
      twoSidedListingShare: 0.2,
      medianQuotedSpreadPct: 5,
      depthToMarketCap: 0.01,
      medianFilledOrderExecutionHours: 8,
      medianAmihudIlliquidity48: 2,
      medianTopTraderNotionalShare48: 0.7,
      wealthGini: 0.9,
      annualizedM2GrowthPct: 8,
      transactionalMoneyShare: 0.3,
      externalBroadMoneyShare: 0.4,
      activeModeledBalanceShare48: 0.25,
      modeledGrossVelocity48: 0.75,
      householdTransactionalVelocity48: 1.2,
      householdSavingsVelocity48: 0.1,
      savingsShareOfHouseholdBalances: 0.4,
      bankCashReservesAnchor: 200,
      ringFencedShareOfLiquid: 0.4,
      measurementConfidence: "medium",
      reconciliationStatus: "amber",
      stockVsFlowTotalDivergent: null,
      stockVsFlowTotalAbsDivergence: null,
      stockVsFlowTopKinds: null,
      residentDemandValueAnchor: null,
      localProducerDemandValueAnchor: null,
      localAbsorptionShare: null,
    });
  });

  it("projects a missing corporate spread as unknown for older snapshots", () => {
    const value = (n: number) => ({ value: n, observations: 1, basis: "test" });
    const snapshot = {
      goods: { pooledFillRate: value(0.6), countryScopedFillRate: value(0.5) },
      trade: {
        intentFulfillmentRate: value(0.4),
        localShare: value(0.7),
        interstateShare: value(0.2),
        importShare: value(0.1),
        toleranceBoundShareOfUnmet: value(0.8),
        capacityBoundShareOfUnmet: value(0.2),
        shortageResponsiveShareOfFulfillment: value(0.15),
      },
      production: { physicalSellThrough: value(0.9), labourStaffingRate: value(0.55) },
      firms: { marketCapHhi: value(2500) },
      competition: {
        medianOwnershipAdjustedSellerHhi: value(3000),
        medianOwnershipAdjustedBuyerHhi: value(2000),
        highConcentrationLowFillShare: value(0.4),
      },
      // Persisted before the corporate spread existed: every projected
      // securities field is present except the new one.
      securities: {
        activeTradedListingShare: value(0.3),
        noHolderBondShare: value(0.6),
        sovereignNoHolderBondShare: value(0.4),
        corporateNoHolderBondShare: value(0.7),
        bondSubscriptionRate: value(0.4),
        corporateMedianHolders: value(2),
        corporateSubscriptionRate: value(0.35),
        twoSidedListingShare: value(0.2),
        medianQuotedSpreadPct: value(5),
        depthToMarketCap: value(0.01),
        medianFilledOrderExecutionHours: value(8),
        medianAmihudIlliquidity48: value(2),
      },
      households: { wealthGini: value(0.9) },
      money: {
        medianAnnualizedM2GrowthPct: value(8),
        transactionalMoneyShare: value(0.3),
        externalBroadMoneyShare: value(0.4),
        activeModeledBalanceShare48: value(0.25),
        modeledGrossVelocity48: value(0.75),
      },
      measurement: { confidence: "high", reasons: [] },
      reconciliation: { status: "green" },
      marketFormation: {
        emptyShare: 0.5,
        facilityReadyEmptyShare: 0.8,
        entryFunnel: {
          corporationsObserved: 10,
          entered: 2,
          explainedOutcomeShare: 1,
        },
      },
    } as unknown as EconomicVitalSigns;

    expect(marketAccessMetricsFromSnapshot(snapshot).corporateMedianPriceToParSpreadPct).toBeNull();
  });

  it("surfaces the stock-vs-flow inventory and resident/local-producer demand split", () => {
    const snapshot = {
      ...minimalSnapshot(),
      reconciliation: {
        status: "amber",
        stockVsFlowByKind: [
          { kind: "character", divergentCount: 3, absDivergence: 100, uninstrumentedCount: 1 },
          { kind: "corporation", divergentCount: 2, absDivergence: 400, uninstrumentedCount: 0 },
        ],
      },
      marketFormation: {
        coverageByState: [
          { stateId: "A", residentDemandValue: 100, localProducerDemandValue: 50 },
          { stateId: "B", residentDemandValue: 200, localProducerDemandValue: 100 },
        ],
      },
    } as unknown as EconomicVitalSigns;

    const metrics = marketAccessMetricsFromSnapshot(snapshot);
    expect(metrics.stockVsFlowTotalDivergent).toBe(5);
    expect(metrics.stockVsFlowTotalAbsDivergence).toBe(500);
    expect(metrics.stockVsFlowTopKinds).toEqual([
      { kind: "corporation", divergentCount: 2, absDivergence: 400, uninstrumentedCount: 0 },
      { kind: "character", divergentCount: 3, absDivergence: 100, uninstrumentedCount: 1 },
    ]);
    expect(metrics.residentDemandValueAnchor).toBe(300);
    expect(metrics.localProducerDemandValueAnchor).toBe(150);
    expect(metrics.localAbsorptionShare).toBe(0.5);
  });

  it("reads a skipped stock-vs-flow check and absent coverage as unknown, not zero", () => {
    const snapshot = {
      ...minimalSnapshot(),
      reconciliation: { status: "green", stockVsFlowByKind: null },
      marketFormation: { coverageByState: [] },
    } as unknown as EconomicVitalSigns;

    const metrics = marketAccessMetricsFromSnapshot(snapshot);
    expect(metrics.stockVsFlowTotalDivergent).toBeNull();
    expect(metrics.stockVsFlowTopKinds).toBeNull();
    expect(metrics.residentDemandValueAnchor).toBeNull();
    expect(metrics.localAbsorptionShare).toBeNull();
  });
});
