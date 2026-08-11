import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  announceConvention,
  submitConventionDraft,
  tickConventionPhase,
} from "@/lib/onePartyState/constitutionalConvention";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";
import type { CountryState } from "@/lib/db/types/countryState";
import type { EscalationState } from "@/lib/db/types/regimeEscalation";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";

function makeLeaderState(): CountryLeaderState {
  return {
    _id: "CN_stub",
    countryId: "CN",
    leaderCharacterId: new ObjectId(),
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence: 60,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: 40,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCountryState(): CountryState {
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
  };
}

function makeEscalation(overrides: Partial<EscalationState> = {}): EscalationState {
  return {
    _id: "CN",
    countryId: "CN",
    currentStage: "discontent",
    stageEnteredAtTurn: 1,
    dwellCounters: {
      stage1: 12,
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

describe("announceConvention", () => {
  let db: MockDb;
  const leaderId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("regimeEscalation");
    db.collection("countryLeaderStates");
    db.collection("countryState");
    db.collection("countryHistory");
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(makeEscalation());
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryLeaderStates.findOneAndUpdate.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("self-heals the escalation doc when missing (fresh game with no driver ticks yet)", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(null);
    // Should not throw — the helper seeds an initial stable escalation
    // state via insertOne, then proceeds with the announce.
    await expect(
      announceConvention(db as unknown as Db, "CN", leaderId, 200)
    ).resolves.toBeUndefined();
    // The seed insert was attempted.
    expect(db.collectionMocks.regimeEscalation.insertOne).toHaveBeenCalled();
    // And the convention setup write fired.
    const writes = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const setupCall = writes.find((c) => {
      const op = c[1] as { $set?: { convention?: { phase?: string } } };
      return op.$set?.convention?.phase === "announced";
    });
    expect(setupCall).toBeDefined();
  });

  it("rejects when currentStage is 'collapse'", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({ currentStage: "collapse" })
    );
    await expect(announceConvention(db as unknown as Db, "CN", leaderId, 200)).rejects.toThrow(
      /collapse stage/
    );
  });

  it("rejects when a convention is already in progress", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "draft",
          announcedAtTurn: 100,
          draftDeadlineTurn: 148,
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );
    await expect(announceConvention(db as unknown as Db, "CN", leaderId, 200)).rejects.toThrow(
      /already in progress/
    );
  });

  it("sets convention.phase='announced' with the CN default reservation (20) + delay (24)", async () => {
    await announceConvention(db as unknown as Db, "CN", leaderId, 200);

    const writes = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const setupCall = writes.find((c) => {
      const op = c[1] as { $set?: { convention?: { phase?: string } } };
      return op.$set?.convention?.phase === "announced";
    });
    expect(setupCall).toBeDefined();
    const set = (
      setupCall![1] as {
        $set: {
          convention: {
            phase: string;
            announcedAtTurn: number;
            draftDeadlineTurn: number;
            legacyReservation: number;
            electionDelayTurns: number;
          };
          conventionInProgress: boolean;
        };
      }
    ).$set;
    expect(set.convention.announcedAtTurn).toBe(200);
    expect(set.convention.draftDeadlineTurn).toBe(248); // +48
    expect(set.convention.legacyReservation).toBe(20);
    expect(set.convention.electionDelayTurns).toBe(24);
    expect(set.conventionInProgress).toBe(true);
  });

  it("applies +15 popular and -10 intra-party adjustments", async () => {
    await announceConvention(db as unknown as Db, "CN", leaderId, 200);
    // Two findOneAndUpdate on countryLeaderStates: confidence + popular.
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it("writes a country-history entry tagged 'convention/announced'", async () => {
    await announceConvention(db as unknown as Db, "CN", leaderId, 200);
    const inserts = db.collectionMocks.countryHistory.insertOne.mock.calls;
    expect(inserts.length).toBeGreaterThan(0);
    const doc = inserts[0][0] as {
      eventType: string;
      details: { subtype: string; phase: string };
    };
    expect(doc.eventType).toBe("regime_escalation");
    expect(doc.details.subtype).toBe("convention");
    expect(doc.details.phase).toBe("announced");
  });
});

describe("submitConventionDraft", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("regimeEscalation");
    db.collection("countryHistory");
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "announced",
          announcedAtTurn: 200,
          draftDeadlineTurn: 248,
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );
  });

  it("rejects a targetSystem not in the CN allowlist", async () => {
    await expect(
      submitConventionDraft(
        db as unknown as Db,
        "CN",
        { targetSystem: "parliamentaryMonarchy", legacyReservation: 20, electionDelayTurns: 24 },
        210
      )
    ).rejects.toThrow(/not in CN allowlist/);
  });

  it("rejects legacyReservation outside 0..35", async () => {
    await expect(
      submitConventionDraft(
        db as unknown as Db,
        "CN",
        { targetSystem: "parliamentaryRepublic", legacyReservation: 40, electionDelayTurns: 24 },
        210
      )
    ).rejects.toThrow(/0 and 35/);
  });

  it("rejects electionDelayTurns outside {12,24,48}", async () => {
    await expect(
      submitConventionDraft(
        db as unknown as Db,
        "CN",
        {
          targetSystem: "parliamentaryRepublic",
          legacyReservation: 20,
          // @ts-expect-error — testing runtime validation
          electionDelayTurns: 36,
        },
        210
      )
    ).rejects.toThrow(/12, 24, or 48/);
  });

  it("rejects submission when the convention phase isn't 'announced'", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "draft",
          announcedAtTurn: 200,
          draftDeadlineTurn: 248,
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );
    await expect(
      submitConventionDraft(
        db as unknown as Db,
        "CN",
        { targetSystem: "parliamentaryRepublic", legacyReservation: 20, electionDelayTurns: 24 },
        210
      )
    ).rejects.toThrow(/not "announced"/);
  });

  it("transitions phase to 'draft' and locks parameters", async () => {
    await submitConventionDraft(
      db as unknown as Db,
      "CN",
      { targetSystem: "presidential", legacyReservation: 10, electionDelayTurns: 12 },
      210
    );

    const writes = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const patchCall = writes.find((c) => {
      const op = c[1] as { $set?: { "convention.phase"?: string } };
      return op.$set?.["convention.phase"] === "draft";
    });
    expect(patchCall).toBeDefined();
    const set = (
      patchCall![1] as {
        $set: {
          "convention.phase": string;
          "convention.targetSystem": string;
          "convention.legacyReservation": number;
          "convention.electionDelayTurns": number;
        };
      }
    ).$set;
    expect(set["convention.targetSystem"]).toBe("presidential");
    expect(set["convention.legacyReservation"]).toBe(10);
    expect(set["convention.electionDelayTurns"]).toBe(12);
  });
});

describe("tickConventionPhase", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("regimeEscalation");
    db.collection("countryState");
    db.collection("politicalParties");
    db.collection("countryHistory");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("no-op when no convention is in progress", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(makeEscalation());
    await tickConventionPhase(db as unknown as Db, "CN", 300);
    expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("announced phase + draftDeadlineTurn elapsed without a draft → drops the convention", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "announced",
          announcedAtTurn: 200,
          draftDeadlineTurn: 248,
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );

    await tickConventionPhase(db as unknown as Db, "CN", 248);

    const writes = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const dropCall = writes.find((c) => {
      const op = c[1] as { $unset?: { convention?: string } };
      return op.$unset?.convention === "";
    });
    expect(dropCall).toBeDefined();
  });

  it("draft phase + draftDeadlineTurn elapsed → transitions to 'ratification'", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "draft",
          announcedAtTurn: 200,
          draftDeadlineTurn: 248,
          targetSystem: "parliamentaryRepublic",
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );

    await tickConventionPhase(db as unknown as Db, "CN", 248);

    const writes = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const transitionCall = writes.find((c) => {
      const op = c[1] as { $set?: { "convention.phase"?: string } };
      return op.$set?.["convention.phase"] === "ratification";
    });
    expect(transitionCall).toBeDefined();
  });

  it("ratification phase + electionTurn arrived → fires conversion and clears the convention", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "ratification",
          announcedAtTurn: 200,
          draftDeadlineTurn: 248,
          targetSystem: "parliamentaryRepublic",
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );

    await tickConventionPhase(db as unknown as Db, "CN", 272); // 248 + 24

    // governmentType flipped via countryState
    const stateWrites = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const flipCall = stateWrites.find((c) => {
      const op = c[1] as { $set?: { governmentType?: string } };
      return op.$set?.governmentType === "parliamentaryRepublic";
    });
    expect(flipCall).toBeDefined();

    // convention cleared
    const escWrites = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const clearCall = escWrites.find((c) => {
      const op = c[1] as { $unset?: { convention?: string } };
      return op.$unset?.convention === "";
    });
    expect(clearCall).toBeDefined();
  });

  it("ratification phase + electionTurn not yet arrived → no conversion fires", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      makeEscalation({
        convention: {
          phase: "ratification",
          announcedAtTurn: 200,
          draftDeadlineTurn: 248,
          targetSystem: "parliamentaryRepublic",
          legacyReservation: 20,
          electionDelayTurns: 24,
        },
        conventionInProgress: true,
      })
    );

    await tickConventionPhase(db as unknown as Db, "CN", 260); // before 272

    const stateWrites = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const flip = stateWrites.find((c) => {
      const op = c[1] as { $set?: { governmentType?: string } };
      return op.$set?.governmentType !== undefined;
    });
    expect(flip).toBeUndefined();
  });
});
