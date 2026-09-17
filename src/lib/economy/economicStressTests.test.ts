import { describe, expect, it } from "vitest";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import {
  freightShockUnmetIntentShare,
  largestSupplierUnmetShare,
  liquidationUnabsorbedShare,
  runEconomicStressTests,
} from "./economicStressTests";

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

  it("reports largest-supplier unmet demand as the implied unmet supply share", () => {
    const finding = runEconomicStressTests(snapshot)[0]!;
    expect(finding.scenario).toBe("largest_supplier_failure");
    expect(finding.indicators.stressedFillRate).toBeCloseTo(0.16);
    expect(finding.indicators.stressedUnmetSupplyShare).toBeCloseTo(0.84);
    // Absolute unmet units stay on the finding; the share is the rate complement.
    expect(finding.unmetDemandUnits).toBeCloseTo(84);
    expect(finding.firstFailure).toBe("commodity:steel");
    expect(finding.recoveryTurns).toBe(24);
  });

  it("reports null largest-supplier unmet share when ownership is unmeasured", () => {
    const unmeasured = {
      ...snapshot,
      competition: { markets: [] },
    } as EconomicVitalSigns;
    const finding = runEconomicStressTests(unmeasured)[0]!;
    expect(finding.firstFailure).toBe("unavailable");
    expect(finding.indicators.stressedFillRate).toBeNull();
    expect(finding.indicators.stressedUnmetSupplyShare).toBeNull();
    expect(finding.severity).toBe("moderate");
    expect(largestSupplierUnmetShare(unmeasured)).toBeNull();
  });

  it("reports freight-shock unmet demand as the implied unmet intent share", () => {
    const finding = runEconomicStressTests(snapshot)[1]!;
    expect(finding.scenario).toBe("freight_capacity_shock");
    expect(finding.indicators.stressedIntentFulfillmentRate).toBeCloseTo(0.6);
    expect(finding.indicators.stressedUnmetIntentShare).toBeCloseTo(0.4);
    // Absolute units stay unavailable: the trade snapshot carries only rates.
    expect(finding.unmetDemandUnits).toBeNull();
    expect(finding.firstFailure).toBe("nonlocal buyer-intent fulfillment");
    expect(finding.recoveryTurns).toBe(24);
  });

  it("reports null freight-shock unmet share when intent inputs are unmeasured", () => {
    const unmeasured = {
      ...snapshot,
      trade: {
        ...snapshot.trade,
        intentFulfillmentRate: value(0.8),
        localShare: { value: null, observations: 0, basis: "test" },
      },
    } as EconomicVitalSigns;
    const finding = runEconomicStressTests(unmeasured)[1]!;
    expect(finding.indicators.stressedIntentFulfillmentRate).toBeNull();
    expect(finding.indicators.stressedUnmetIntentShare).toBeNull();
    expect(finding.severity).toBe("moderate");
    expect(
      freightShockUnmetIntentShare(unmeasured, {
        freightCapacityLossShare: 0.5,
        freightShockTurns: 12,
        exchangeClosureTurns: 12,
        liquidationShareOfMarketCap: 0.1,
        dormantBalanceReactivationShare: 0.5,
      })
    ).toBeNull();
  });

  it("does not describe unabsorbed liquidation notional as a realized loss", () => {
    const finding = runEconomicStressTests(snapshot)[3]!;
    expect(finding.indicators.absorptionRate).toBe(0.2);
    expect(finding.balanceSheetLossAnchor).toBe(80);
    expect(finding.basis).toContain("liquidity exposure");
  });

  it("reports liquidation unmet demand as the implied unabsorbed share", () => {
    const finding = runEconomicStressTests(snapshot)[3]!;
    expect(finding.scenario).toBe("synchronized_liquidation");
    expect(finding.indicators.unabsorbedShare).toBeCloseTo(0.8);
    // Absolute units stay unavailable: the securities snapshot carries notional and
    // depth, never demand units.
    expect(finding.unmetDemandUnits).toBeNull();
    expect(finding.firstFailure).toBe("open equity order-book depth");
    expect(finding.recoveryTurns).toBe(24);
  });

  it("reports null liquidation unabsorbed share when nothing is offered", () => {
    const empty = {
      ...snapshot,
      firms: { marketCapitalizationAnchor: 0 },
    } as EconomicVitalSigns;
    const finding = runEconomicStressTests(empty)[3]!;
    expect(finding.indicators.absorptionRate).toBeNull();
    expect(finding.indicators.unabsorbedShare).toBeNull();
    expect(finding.severity).toBe("moderate");
    expect(
      liquidationUnabsorbedShare(empty, {
        freightCapacityLossShare: 0.5,
        freightShockTurns: 12,
        exchangeClosureTurns: 12,
        liquidationShareOfMarketCap: 0.1,
        dormantBalanceReactivationShare: 0.5,
      })
    ).toBeNull();
  });

  it("reports zero liquidation unabsorbed share when depth absorbs the offer", () => {
    const deep = {
      ...snapshot,
      securities: { ...snapshot.securities, openOrderDepthAnchor: 10_000 },
    } as EconomicVitalSigns;
    const finding = runEconomicStressTests(deep)[3]!;
    expect(finding.indicators.absorptionRate).toBe(1);
    expect(finding.indicators.unabsorbedShare).toBe(0);
    expect(finding.balanceSheetLossAnchor).toBe(0);
  });
});
