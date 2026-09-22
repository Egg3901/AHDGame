import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, UnownedSector } from "@/lib/db/types";
import type { NppMarketEntryDiagnostic } from "@/lib/db/types/marketFormation";
import {
  createFrontierEntryTurnState,
  evaluateFrontierCandidate,
  settleFrontierEntryPlacement,
  type FrontierCandidate,
} from "./frontierEntryCandidate";

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    ...overrides,
  } as unknown as Corporation;
}

function candidate(stateId = "NY"): UnownedSector {
  return { stateId, countryId: "US", sectorType: "manufacturing" } as unknown as UnownedSector;
}

function diagnostic(reason: NppMarketEntryDiagnostic["reason"]): NppMarketEntryDiagnostic {
  return {
    corporationId: new ObjectId().toString(),
    countryId: "US",
    reason,
    sectorCount: 3,
    logisticsSupportedSectors: 10,
    profitable: false,
    marginPct: 0,
    marginFloorPct: 10,
    cohortEligible: true,
    strategyAllowsExpansion: true,
    targetStateId: "NY",
  };
}

const gates = {
  allowExpansion: true,
  hasLogisticsCapacity: true,
  marketEntryEligible: true,
  retailBlocked: false,
  targetGlutted: false,
};

describe("frontierEntryCandidate seam", () => {
  it("resolves the flag fail-closed", () => {
    expect(createFrontierEntryTurnState(undefined)).toBeUndefined();
    expect(createFrontierEntryTurnState(false)).toBeUndefined();
    expect(createFrontierEntryTurnState("true")).toBeUndefined();
    const on = createFrontierEntryTurnState(true);
    expect(on?.enabled).toBe(true);
    expect(on?.enteredCohorts.size).toBe(0);
    expect(on?.enteredControllers.size).toBe(0);
  });

  it("evaluates null without state, candidate, or relaxable reason", () => {
    const corporation = corp();
    const state = createFrontierEntryTurnState(true);
    expect(
      evaluateFrontierCandidate({
        turnState: undefined,
        corp: corporation,
        candidate: candidate(),
        diagnostic: diagnostic("unprofitable"),
        gates,
      })
    ).toBeNull();
    expect(
      evaluateFrontierCandidate({
        turnState: { enabled: false, enteredCohorts: new Set(), enteredControllers: new Set() },
        corp: corporation,
        candidate: candidate(),
        diagnostic: diagnostic("unprofitable"),
        gates,
      })
    ).toBeNull();
    expect(
      evaluateFrontierCandidate({
        turnState: state,
        corp: corporation,
        candidate: null,
        diagnostic: diagnostic("unprofitable"),
        gates,
      })
    ).toBeNull();
    expect(
      evaluateFrontierCandidate({
        turnState: state,
        corp: corporation,
        candidate: candidate(),
        diagnostic: diagnostic("state_controlled"),
        gates,
      })
    ).toBeNull();
  });

  it("grants one priced evaluation per cohort and controller", () => {
    const corporation = corp();
    const state = createFrontierEntryTurnState(true);
    const first = evaluateFrontierCandidate({
      turnState: state,
      corp: corporation,
      candidate: candidate(),
      diagnostic: diagnostic("unprofitable"),
      gates,
    });
    expect(first).toMatchObject({
      cohortKey: "US\0NY",
      controllerKey: corporation._id.toString(),
      relaxedReason: "unprofitable",
    });
    expect(first?.target.stateId).toBe("NY");
    // A re-verification gate failing keeps its own reason and never qualifies.
    expect(
      evaluateFrontierCandidate({
        turnState: state,
        corp: corporation,
        candidate: candidate(),
        diagnostic: diagnostic("cash_floor"),
        gates: { ...gates, retailBlocked: true },
      })
    ).toBeNull();
    // Consumed slots block a second entrant in the same cohort.
    settleFrontierEntryPlacement({
      turnState: state,
      frontier: first as FrontierCandidate,
      diagnostic: { ...diagnostic("entered"), targetStateId: "NY" },
      corp: corporation,
      fallbackCandidate: candidate(),
      ordinaryEntry: false,
      exceptionalShortageEntry: false,
    });
    expect(
      evaluateFrontierCandidate({
        turnState: state,
        corp: corporation,
        candidate: candidate(),
        diagnostic: diagnostic("margin_below_floor"),
        gates,
      })
    ).toBeNull();
  });

  it("records ordinary placements without the trial marker", () => {
    const corporation = corp();
    const state = createFrontierEntryTurnState(true);
    const placed = diagnostic("entered");
    const settled = settleFrontierEntryPlacement({
      turnState: state,
      frontier: null,
      diagnostic: placed,
      corp: corporation,
      fallbackCandidate: candidate(),
      ordinaryEntry: true,
      exceptionalShortageEntry: false,
    });
    expect(settled?.frontierExperiment).toBeUndefined();
    expect(state?.enteredCohorts.has("US\0NY")).toBe(true);
    expect(state?.enteredControllers.has(corporation._id.toString())).toBe(true);
    // Flag off leaves the diagnostic untouched.
    expect(
      settleFrontierEntryPlacement({
        turnState: undefined,
        frontier: null,
        diagnostic: placed,
        corp: corporation,
        fallbackCandidate: candidate(),
        ordinaryEntry: true,
        exceptionalShortageEntry: false,
      })
    ).toBe(placed);
  });

  it("marks experiment placements with the relaxed reason", () => {
    const corporation = corp();
    const state = createFrontierEntryTurnState(true);
    const frontier = evaluateFrontierCandidate({
      turnState: state,
      corp: corporation,
      candidate: candidate(),
      diagnostic: diagnostic("cash_floor"),
      gates,
    });
    const settled = settleFrontierEntryPlacement({
      turnState: state,
      frontier,
      diagnostic: { ...diagnostic("entered"), targetStateId: "NY" },
      corp: corporation,
      fallbackCandidate: candidate(),
      ordinaryEntry: false,
      exceptionalShortageEntry: false,
    });
    expect(settled?.frontierExperiment).toMatchObject({
      cohortKey: "US\0NY",
      controllerKey: corporation._id.toString(),
      relaxedReason: "cash_floor",
    });
  });

  it("dedups controllers under common control", () => {
    const parentId = new ObjectId();
    const first = corp({ parentDividendFloorSetByCorpId: parentId });
    const second = corp({ parentDividendFloorSetByCorpId: parentId });
    const state = createFrontierEntryTurnState(true);
    const evaluation = evaluateFrontierCandidate({
      turnState: state,
      corp: first,
      candidate: candidate("NY"),
      diagnostic: diagnostic("unprofitable"),
      gates,
    });
    expect(evaluation?.controllerKey).toBe(parentId.toString());
    settleFrontierEntryPlacement({
      turnState: state,
      frontier: evaluation,
      diagnostic: { ...diagnostic("entered"), targetStateId: "NY" },
      corp: first,
      fallbackCandidate: candidate("NY"),
      ordinaryEntry: false,
      exceptionalShortageEntry: false,
    });
    // Same controller in another cohort is still blocked this turn.
    expect(
      evaluateFrontierCandidate({
        turnState: state,
        corp: second,
        candidate: candidate("CA"),
        diagnostic: { ...diagnostic("unprofitable"), targetStateId: "CA" },
        gates,
      })
    ).toBeNull();
  });
});
