import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Corporation } from "@/lib/db/types";
import {
  blankNppCandidateExclusions,
  buildNppMarketEntryDiagnostic,
  initialNppMarketEntryReason,
  resolveFoundingShortfallReason,
  summarizeNppMarketEntryFunnel,
} from "./entryDiagnostics";

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

describe("initialNppMarketEntryReason", () => {
  const open = {
    strategyAllowsExpansion: true,
    profitable: true,
    marginPct: 20,
    marginFloorPct: 15,
    hasCandidate: true,
    hasLogisticsCapacity: true,
    cohortEligible: true,
  };

  it("names each pre-pricing gate in evaluation order", () => {
    expect(initialNppMarketEntryReason({ ...open, strategyAllowsExpansion: false })).toBe(
      "strategy_disallowed"
    );
    expect(initialNppMarketEntryReason({ ...open, profitable: false })).toBe("unprofitable");
    expect(initialNppMarketEntryReason({ ...open, marginPct: 10, marginFloorPct: 15 })).toBe(
      "margin_below_floor"
    );
    expect(initialNppMarketEntryReason({ ...open, hasCandidate: false })).toBe(
      "no_enterable_market"
    );
    expect(initialNppMarketEntryReason({ ...open, hasLogisticsCapacity: false })).toBe(
      "logistics_capacity"
    );
    expect(initialNppMarketEntryReason({ ...open, cohortEligible: false })).toBe(
      "cohort_ineligible"
    );
    expect(initialNppMarketEntryReason({ ...open, retailBlocked: true })).toBe("retail_paused");
    expect(initialNppMarketEntryReason({ ...open, targetGlutted: true })).toBe("glutted_market");
    expect(initialNppMarketEntryReason({ ...open, entryCapReached: true })).toBe("entry_cap");
    expect(initialNppMarketEntryReason(open)).toBe("cash_floor");
  });

  it("reports state_controlled when nationalized buckets are the only block", () => {
    expect(
      initialNppMarketEntryReason({
        ...open,
        hasCandidate: false,
        candidateExclusions: {
          ...blankNppCandidateExclusions(),
          stateControlledExcluded: 3,
        },
      })
    ).toBe("state_controlled");
  });

  it("keeps no_enterable_market when other filters also bound", () => {
    expect(
      initialNppMarketEntryReason({
        ...open,
        hasCandidate: false,
        candidateExclusions: {
          ...blankNppCandidateExclusions(),
          stateControlledExcluded: 3,
          emptyPoolExcluded: 1,
        },
      })
    ).toBe("no_enterable_market");
  });

  it("an earlier gate wins over a later one", () => {
    expect(
      initialNppMarketEntryReason({
        ...open,
        hasLogisticsCapacity: false,
        cohortEligible: false,
        retailBlocked: true,
        targetGlutted: true,
      })
    ).toBe("logistics_capacity");
  });
});

describe("resolveFoundingShortfallReason", () => {
  it("distinguishes real founding cost from the pre-pricing cash floor", () => {
    expect(
      resolveFoundingShortfallReason({
        creditPath: false,
        sizeBlocked: false,
        exceptionalShortageEntry: false,
      })
    ).toBe("founding_cost");
  });

  it("preserves the credit, size, and restricted paths in branch order", () => {
    expect(
      resolveFoundingShortfallReason({
        creditPath: true,
        sizeBlocked: true,
        exceptionalShortageEntry: true,
      })
    ).toBe("credit_requested");
    expect(
      resolveFoundingShortfallReason({
        creditPath: false,
        sizeBlocked: true,
        exceptionalShortageEntry: true,
      })
    ).toBe("facility_size");
    expect(
      resolveFoundingShortfallReason({
        creditPath: false,
        sizeBlocked: false,
        exceptionalShortageEntry: true,
      })
    ).toBe("state_credit_restricted");
  });
});

describe("buildNppMarketEntryDiagnostic gates", () => {
  const corp = { _id: new ObjectId(), countryId: "US" } as Corporation;
  const base = {
    corporation: corp,
    sectorCount: 2,
    logisticsSupportedSectors: 10,
    profitable: true,
    marginPct: 30,
    marginFloorPct: 15,
    cohortEligible: true,
    strategyAllowsExpansion: true,
    hasLogisticsCapacity: true,
    frontierStates: new Set<string>(),
  };

  it("reports a glutted ordinary target instead of the cash floor", () => {
    const diagnostic = buildNppMarketEntryDiagnostic({
      ...base,
      target: { stateId: "PA", sectorType: "manufacturing" },
      targetGlutted: true,
    });

    expect(diagnostic.reason).toBe("glutted_market");
  });

  it("reports a retail pause on a retail candidate", () => {
    const diagnostic = buildNppMarketEntryDiagnostic({
      ...base,
      target: { stateId: "PA", sectorType: "retail" },
      retailBlocked: true,
    });

    expect(diagnostic.reason).toBe("retail_paused");
  });
});
