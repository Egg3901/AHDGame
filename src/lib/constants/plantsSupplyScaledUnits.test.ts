/**
 * The clearing OFFER (turn/corporation/index.ts) and the world-supply LEDGER
 * (computeRawSupplyDemand) must scale `producedUnits` by the identical chain.
 * The offer is flagged `realUnits` and is therefore EXEMPT from clearing's
 * lagged-supply normalization, so a divergence is no longer caught by anything:
 * before this helper the offer omitted `embargoSupplyFactor` and an embargoed
 * sector over-offered against a ledger that had written those units off.
 */

import { describe, it, expect } from "vitest";
import {
  computeRawSupplyDemand,
  embargoSupplyFactorFor,
  plantsSupplyScaledUnits,
  type CommodityType,
} from "./commodities";
import { TRADE_EMBARGO_EXPORT_LOSS_SHARE } from "@/lib/trade/constants";

describe("embargoSupplyFactorFor", () => {
  it("is 0 under a total suspension and 1 with no exposure", () => {
    expect(embargoSupplyFactorFor({ embargoSuspended: true, embargoExportExposure: 0.5 })).toBe(0);
    expect(embargoSupplyFactorFor({})).toBe(1);
  });
  it("writes off the exported share", () => {
    expect(embargoSupplyFactorFor({ embargoExportExposure: 0.5 })).toBeCloseTo(
      1 - 0.5 * TRADE_EMBARGO_EXPORT_LOSS_SHARE,
      10
    );
  });
  it("clamps a garbage exposure into [0, 1]", () => {
    expect(embargoSupplyFactorFor({ embargoExportExposure: 5 })).toBe(
      1 - TRADE_EMBARGO_EXPORT_LOSS_SHARE
    );
    expect(embargoSupplyFactorFor({ embargoExportExposure: -3 })).toBe(1);
  });
});

describe("plantsSupplyScaledUnits", () => {
  it("returns null with no measured production, so the caller falls back", () => {
    expect(
      plantsSupplyScaledUnits({
        producedUnits: null,
        isNatcorp: false,
        productionPolicyLevel: 0,
      })
    ).toBeNull();
  });

  it("applies the embargo write-off", () => {
    const open = plantsSupplyScaledUnits({
      producedUnits: 1000,
      isNatcorp: false,
      productionPolicyLevel: 0,
    })!;
    const embargoed = plantsSupplyScaledUnits({
      producedUnits: 1000,
      isNatcorp: false,
      productionPolicyLevel: 0,
      embargoSupplyFactor: 0.7,
    })!;
    expect(embargoed).toBeCloseTo(open * 0.7, 10);
  });

  it("matches the world-supply ledger exactly for an embargoed sector", () => {
    // Ledger side: total supply units contributed by one embargoed plant.
    const ledgerTotal = (embargoSupplyFactor: number) => {
      const byState = computeRawSupplyDemand(
        [
          {
            sectorType: "manufacturing",
            revenue: 1_000_000,
            stateId: "S1",
            producedUnits: 1000,
            productionPolicyLevel: 20,
            embargoSupplyFactor,
          },
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        false,
        true // plantsEnabled
      ).byState.get("S1")!;
      let total = 0;
      for (const v of byState.values()) total += v.supply;
      return total;
    };
    // The offer side reproduces the identical scaled scalar. The per-commodity
    // mix weights sum to 1, so the ledger total is that scalar.
    const offer = plantsSupplyScaledUnits({
      producedUnits: 1000,
      isNatcorp: false,
      productionPolicyLevel: 20,
      embargoSupplyFactor: 0.7,
    })!;
    expect(ledgerTotal(0.7)).toBeCloseTo(offer, 6);
    // And the un-embargoed case still lines up, so the fix did not shift the base.
    const openOffer = plantsSupplyScaledUnits({
      producedUnits: 1000,
      isNatcorp: false,
      productionPolicyLevel: 20,
    })!;
    expect(ledgerTotal(1)).toBeCloseTo(openOffer, 6);
  });
});

// Extraction stays OUT of the producedUnits path on BOTH sides: the ledger
// excludes it (`st !== "extraction"`) because sector.revenue is restated to the
// capacity nameplate under plants so the geological ration applies exactly once,
// and the offer must therefore not be flagged `realUnits` either or the
// normalization that reconciles those two figures is switched off.
describe("extraction stays on the legacy derivation under plants", () => {
  const run = (plantsEnabled: boolean) =>
    computeRawSupplyDemand(
      [
        {
          sectorType: "extraction",
          revenue: 1_000_000,
          stateId: "S1",
          producedUnits: 1,
        },
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      plantsEnabled
    ).byState.get("S1")!;

  it("ignores producedUnits for extraction supply", () => {
    const on = run(true);
    const off = run(false);
    for (const [c, v] of on as Map<CommodityType, { supply: number; demand: number }>) {
      expect(v.supply).toBeCloseTo(off.get(c)!.supply, 6);
    }
  });
});
