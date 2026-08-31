import { describe, expect, it } from "vitest";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import { runEconomicStressTests } from "./economicStressTests";

const value = (number: number) => ({ value: number, observations: 1, basis: "test" });

const snapshot = {
  competition: {
    markets: [
      {
        commodity: "steel",
        pooledFillRate: 0.8,
        supplyUnits: 80,
        demandUnits: 100,
        priceAnchorPerUnit: 10,
        participantSellerUnits: 100,
        sellerCount: 3,
        buyerCount: 3,
        sellerHhi: 4400,
        buyerHhi: 3400,
        ownershipAdjustedSellerHhi: 6800,
        ownershipAdjustedBuyerHhi: 3400,
        largestOwnershipAdjustedSellerShare: 0.8,
        largestOwnershipAdjustedSellerUnits: 80,
        highConcentrationLowFill: false,
      },
    ],
  },
  trade: {
    intentFulfillmentRate: value(0.8),
    localShare: value(0.5),
    interstateShare: value(0.3),
    importShare: value(0.2),
  },
  securities: {
    equityNotionalAnchor48Turns: 480,
    activeTradedListingShare: value(0.4),
    openOrderDepthAnchor: 20,
  },
  firms: { marketCapitalizationAnchor: 1_000 },
  money: { dormantModeledBalanceShare48: value(0.3) },
} as EconomicVitalSigns;

describe("runEconomicStressTests", () => {
  it("reports all five declared scenarios", () => {
    expect(runEconomicStressTests(snapshot).map((finding) => finding.scenario)).toEqual([
      "largest_supplier_failure",
      "freight_capacity_shock",
      "exchange_closure",
      "synchronized_liquidation",
      "dormant_balance_reactivation",
    ]);
  });

  it("finds the first commodity failure after removing the largest ownership group", () => {
    const finding = runEconomicStressTests(snapshot)[0]!;
    expect(finding.firstFailure).toBe("commodity:steel");
    expect(finding.indicators.stressedFillRate).toBeCloseTo(0.16);
    expect(finding.indicators.removedSupplyUnits).toBeCloseTo(64);
    expect(finding.unmetDemandUnits).toBeCloseTo(84);
    expect(finding.balanceSheetLossAnchor).toBeCloseTo(840);
    expect(finding.severity).toBe("critical");
  });

  it("does not describe unabsorbed liquidation notional as a realized loss", () => {
    const finding = runEconomicStressTests(snapshot)[3]!;
    expect(finding.indicators.absorptionRate).toBe(0.2);
    expect(finding.balanceSheetLossAnchor).toBe(80);
    expect(finding.basis).toContain("liquidity exposure");
  });
});
