import { describe, expect, it } from "vitest";
import { summarizeNppMarketEntryFunnel } from "./entryDiagnostics";

describe("summarizeNppMarketEntryFunnel", () => {
  it("assigns every corporation to one exclusive outcome", () => {
    const snapshot = summarizeNppMarketEntryFunnel({
      turn: 440,
      now: new Date("2026-08-28T00:00:00Z"),
      diagnostics: [
        {
          corporationId: "a",
          countryId: "US",
          reason: "entered",
          sectorCount: 3,
          logisticsSupportedSectors: 10,
          profitable: true,
          marginPct: 20,
          marginFloorPct: 15,
          cohortEligible: true,
          strategyAllowsExpansion: true,
        },
        {
          corporationId: "b",
          countryId: "US",
          reason: "cash_floor",
          sectorCount: 4,
          logisticsSupportedSectors: 10,
          profitable: true,
          marginPct: 20,
          marginFloorPct: 15,
          cohortEligible: true,
          strategyAllowsExpansion: true,
        },
        {
          corporationId: "c",
          countryId: "US",
          reason: "cohort_ineligible",
          sectorCount: 5,
          logisticsSupportedSectors: 10,
          profitable: true,
          marginPct: 20,
          marginFloorPct: 15,
          cohortEligible: false,
          strategyAllowsExpansion: true,
        },
      ],
    });

    expect(snapshot.corporationsObserved).toBe(3);
    expect(snapshot.entered).toBe(1);
    expect(snapshot.rejected).toBe(2);
    expect(snapshot.reasonCounts).toEqual({ entered: 1, cash_floor: 1, cohort_ineligible: 1 });
  });
});
