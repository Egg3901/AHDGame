import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  checkForcedConversion,
  triggerSystemConversion,
} from "@/lib/onePartyState/systemConversion";
import type { CountryState } from "@/lib/db/types/countryState";
import type { EscalationState } from "@/lib/db/types/regimeEscalation";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";

function makeCountryState(overrides: Partial<CountryState> = {}): CountryState {
  return {
    _id: "CN",
    countryId: "CN",
    governmentType: "onePartyState",
    rulingPartyId: 1,
    opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS },
    hasLeaderConfidenceModel: true,
    reformCooldowns: {},
    popularBoostModifiers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEscalation(overrides: Partial<EscalationState> = {}): EscalationState {
  return {
    _id: "CN",
    countryId: "CN",
    currentStage: "stable",
    stageEnteredAtTurn: 1,
    dwellCounters: {
      stage1: 0,
      stage2: { sustained: 0, cumulativeIn168: 0 },
      stage3: 0,
      stage4: 0,
    },
    conventionInProgress: false,
    activeDecision: null,
    decisionQueue: [],
    transitionHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("triggerSystemConversion", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collection("politicalParties");
    db.collection("countryHistory");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("flips governmentType to the target system + clears opsVoteMultipliers + hasLeaderConfidenceModel", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 500, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 20,
      path: "voluntary",
    });

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const flipCall = writes.find((c) => {
      const op = c[1] as {
        $set?: {
          governmentType?: string;
          opsVoteMultipliers?: unknown;
          hasLeaderConfidenceModel?: boolean;
        };
      };
      return (
        op.$set?.governmentType === "parliamentaryRepublic" &&
        op.$set?.opsVoteMultipliers === null &&
        op.$set?.hasLeaderConfidenceModel === false
      );
    });
    expect(flipCall).toBeDefined();
  });

  it("clears regimeStatus across every party in the country", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 500, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 20,
      path: "voluntary",
    });

    const calls = db.collectionMocks.politicalParties.updateMany.mock.calls;
    expect(calls).toHaveLength(1);
    const filter = calls[0][0] as { countryId: string };
    expect(filter.countryId).toBe("CN");
    const set = (calls[0][1] as { $set: { regimeStatus: unknown } }).$set;
    expect(set.regimeStatus).toBeNull();
  });

  it("writes the post-conversion election marker via bootstrap (voluntary path)", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 500, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 20,
      path: "voluntary",
      electionAtTurn: 524,
    });

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const markerCall = writes.find((c) => {
      const op = c[1] as {
        $set?: {
          pendingPostConversionElection?: { atTurn: number; legacyReservation: number };
        };
      };
      return op.$set?.pendingPostConversionElection?.atTurn === 524;
    });
    expect(markerCall).toBeDefined();
  });

  it("forced path stamps the vote-share penalty on the marker", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 500, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 5,
      path: "forced",
      forcedVoteSharePenalty: -0.2,
    });

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const markerCall = writes.find((c) => {
      const op = c[1] as {
        $set?: { pendingPostConversionElection?: { forcedVoteSharePenalty?: number } };
      };
      return op.$set?.pendingPostConversionElection?.forcedVoteSharePenalty === -0.2;
    });
    expect(markerCall).toBeDefined();
  });

  it("appends a regime_escalation history entry tagged with subtype 'conversion'", async () => {
    await triggerSystemConversion(db as unknown as Db, "CN", 500, {
      targetSystem: "parliamentaryRepublic",
      legacyReservation: 20,
      path: "voluntary",
    });

    const inserts = db.collectionMocks.countryHistory.insertOne.mock.calls;
    expect(inserts.length).toBeGreaterThan(0);
    const doc = inserts[0][0] as {
      eventType: string;
      details: { subtype: string; path: string };
    };
    expect(doc.eventType).toBe("regime_escalation");
    expect(doc.details.subtype).toBe("conversion");
    expect(doc.details.path).toBe("voluntary");
  });
});

describe("checkForcedConversion", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collection("politicalParties");
    db.collection("countryHistory");
    db.collection("regimeEscalation");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("no-ops when the country has no collapseTargetSystem in its config", async () => {
    // US is presidential w/o collapseTargetSystem — should silently no-op.
    await checkForcedConversion(db as unknown as Db, "US", 500);
    expect(db.collectionMocks.countryState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("voluntary 'acceptPeacefully' path: fires when conversionPendingAtTurn has arrived", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({ conversionPendingAtTurn: 500 })
    );

    await checkForcedConversion(db as unknown as Db, "CN", 500);

    // Flip happened
    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const flip = writes.find((c) => {
      const op = c[1] as { $set?: { governmentType?: string } };
      return op.$set?.governmentType === "parliamentaryRepublic";
    });
    expect(flip).toBeDefined();
    // conversionPendingAtTurn was cleared
    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const clearCall = escCalls.find((c) => {
      const op = c[1] as { $unset?: { conversionPendingAtTurn?: string } };
      return op.$unset?.conversionPendingAtTurn === "";
    });
    expect(clearCall).toBeDefined();
  });

  it("voluntary path: no-op when conversionPendingAtTurn is still in the future", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({ conversionPendingAtTurn: 600 })
    );

    await checkForcedConversion(db as unknown as Db, "CN", 500);

    expect(db.collectionMocks.countryState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("Stage-4 collapse with no convention: fires forced conversion", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({ currentStage: "collapse" })
    );

    await checkForcedConversion(db as unknown as Db, "CN", 500);

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const flip = writes.find((c) => {
      const op = c[1] as { $set?: { governmentType?: string } };
      return op.$set?.governmentType === "parliamentaryRepublic";
    });
    expect(flip).toBeDefined();
  });

  it("Stage-4 collapse + active convention: does NOT fire (lets the convention complete)", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        currentStage: "collapse",
        convention: {
          phase: "draft",
          announcedAtTurn: 400,
          draftDeadlineTurn: 448,
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
      })
    );

    await checkForcedConversion(db as unknown as Db, "CN", 500);
    expect(db.collectionMocks.countryState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("Stage-4 collapse + stage4Delay (still active): does NOT fire yet", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        currentStage: "collapse",
        stage4Delay: { untilTurn: 600, halveLegacyBonusIfStillBelow15: true },
      })
    );

    await checkForcedConversion(db as unknown as Db, "CN", 500);
    expect(db.collectionMocks.countryState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("Stage-4 collapse + stage4Delay elapsed + halveLegacyBonusIfStillBelow15: halves legacy reservation to 3", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        currentStage: "collapse",
        stage4Delay: { untilTurn: 500, halveLegacyBonusIfStillBelow15: true },
      })
    );

    await checkForcedConversion(db as unknown as Db, "CN", 500);

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const markerCall = writes.find((c) => {
      const op = c[1] as {
        $set?: { pendingPostConversionElection?: { legacyReservation?: number } };
      };
      return op.$set?.pendingPostConversionElection?.legacyReservation === 3;
    });
    expect(markerCall).toBeDefined();
  });
});
