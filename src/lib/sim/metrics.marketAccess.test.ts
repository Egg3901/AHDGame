import { describe, expect, it } from "vitest";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import { marketAccessMetricsFromSnapshot } from "./metrics";

describe("marketAccessMetricsFromSnapshot", () => {
  it("returns unavailable values when an older sandbox has no vital-sign snapshot", () => {
    expect(marketAccessMetricsFromSnapshot(null)).toMatchObject({
      pooledFillRate: null,
      intentFulfillmentRate: null,
      reconciliationStatus: "unavailable",
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
      twoSidedListingShare: 0.2,
      medianQuotedSpreadPct: 5,
      depthToMarketCap: 0.01,
      medianFilledOrderExecutionHours: 8,
      medianAmihudIlliquidity48: 2,
      wealthGini: 0.9,
      annualizedM2GrowthPct: 8,
      transactionalMoneyShare: 0.3,
      externalBroadMoneyShare: 0.4,
      activeModeledBalanceShare48: 0.25,
      modeledGrossVelocity48: 0.75,
      measurementConfidence: "medium",
      reconciliationStatus: "amber",
    });
  });
});
