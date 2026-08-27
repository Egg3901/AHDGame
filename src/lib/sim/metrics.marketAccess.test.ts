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
      },
      production: { physicalSellThrough: value(0.9), labourStaffingRate: value(0.55) },
      firms: { marketCapHhi: value(2500) },
      securities: {
        activeTradedListingShare: value(0.3),
        noHolderBondShare: value(0.6),
      },
      households: { wealthGini: value(0.9) },
      money: { medianAnnualizedM2GrowthPct: value(8) },
      reconciliation: { status: "amber" },
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
      physicalSellThrough: 0.9,
      labourStaffingRate: 0.55,
      marketCapHhi: 2500,
      activeTradedListingShare: 0.3,
      noHolderBondShare: 0.6,
      wealthGini: 0.9,
      annualizedM2GrowthPct: 8,
      reconciliationStatus: "amber",
    });
  });
});
