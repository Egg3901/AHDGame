import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Corporation } from "@/lib/db/types";
import type { NppMarketEntryReason } from "@/lib/db/types/marketFormation";
import {
  blankNppCandidateExclusions,
  buildNppMarketEntryDiagnostic,
  initialNppMarketEntryReason,
  normalizeNppMarketEntryFunnel,
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

describe("funnel reason coverage", () => {
  // Every primary reason the funnel can publish, including the post-pricing
  // shortfalls and the credit-resolution outcomes: tsc rejects any literal
  // outside the union, and the funnel must count each exactly once.
  const everyReason: NppMarketEntryReason[] = [
    "entered",
    "strategy_disallowed",
    "unprofitable",
    "margin_below_floor",
    "no_enterable_market",
    "state_controlled",
    "logistics_capacity",
    "cohort_ineligible",
    "retail_paused",
    "glutted_market",
    "entry_cap",
    "facility_size",
    "cash_floor",
    "founding_cost",
    "credit_requested",
    "credit_cooldown",
    "credit_capacity",
    "credit_issuance_failed",
    "credit_rounding_shortfall",
    "state_credit_restricted",
  ];

  it("gives every candidate exactly one stable primary reason", () => {
    const funnel = summarizeNppMarketEntryFunnel({
      turn: 440,
      now: new Date("2026-08-28T00:00:00Z"),
      diagnostics: everyReason.map((reason, index) => ({
        corporationId: `corp-${index}`,
        countryId: "US",
        reason,
        sectorCount: 1,
        logisticsSupportedSectors: 1,
        profitable: reason !== "unprofitable",
        marginPct: 20,
        marginFloorPct: 15,
        cohortEligible: reason !== "cohort_ineligible",
        strategyAllowsExpansion: reason !== "strategy_disallowed",
      })),
    });

    expect(funnel.corporationsObserved).toBe(everyReason.length);
    expect(funnel.entered).toBe(1);
    expect(funnel.rejected).toBe(everyReason.length - 1);
    expect(Object.values(funnel.reasonCounts).reduce((sum, count) => sum + (count ?? 0), 0)).toBe(
      everyReason.length
    );
    const explained = funnel.diagnostics.filter((row) => typeof row.reason === "string").length;
    expect(explained / funnel.corporationsObserved).toBe(1);
  });

  it("names one reason for every gate-flag combination", () => {
    const flags = [true, false];
    for (const strategy of flags)
      for (const profitable of flags)
        for (const candidate of [true, false])
          for (const logistics of flags)
            for (const cohort of flags)
              for (const retail of flags)
                for (const glutted of flags)
                  for (const capped of flags) {
                    const reason = initialNppMarketEntryReason({
                      strategyAllowsExpansion: strategy,
                      profitable,
                      marginPct: profitable ? 20 : 0,
                      marginFloorPct: 15,
                      hasCandidate: candidate,
                      hasLogisticsCapacity: logistics,
                      cohortEligible: cohort,
                      retailBlocked: retail,
                      targetGlutted: glutted,
                      entryCapReached: capped,
                    });
                    expect(typeof reason).toBe("string");
                    expect(reason.length).toBeGreaterThan(0);
                  }
  });
});

describe("normalizeNppMarketEntryFunnel", () => {
  it("serves a pre-evidence funnel document with derived aggregates", () => {
    const normalized = normalizeNppMarketEntryFunnel({
      _id: "current",
      turn: 439,
      diagnostics: [
        { corporationId: "a", countryId: "US", reason: "entered" },
        { corporationId: "b", countryId: "US", reason: "cash_floor" },
      ],
    });

    expect(normalized).toMatchObject({
      _id: "current",
      schemaVersion: 1,
      turn: 439,
      corporationsObserved: 2,
      entered: 1,
      rejected: 1,
      reasonCounts: { entered: 1, cash_floor: 1 },
    });
    expect(normalized?.diagnostics).toHaveLength(2);
  });

  it("preserves reasons outside the current union instead of dropping them", () => {
    const normalized = normalizeNppMarketEntryFunnel({
      _id: "turn:440",
      turn: 440,
      corporationsObserved: 1,
      entered: 0,
      rejected: 1,
      reasonCounts: { some_future_gate: 1 },
      diagnostics: [{ corporationId: "a", countryId: "US", reason: "some_future_gate" }],
    });

    expect(normalized?.reasonCounts).toEqual({ some_future_gate: 1 });
    expect(normalized?.diagnostics[0]).toMatchObject({ reason: "some_future_gate" });
  });

  it("rejects non-documents", () => {
    expect(normalizeNppMarketEntryFunnel(null)).toBeNull();
    expect(normalizeNppMarketEntryFunnel("turn:440")).toBeNull();
    expect(normalizeNppMarketEntryFunnel(undefined)).toBeNull();
  });
});
