import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stage1AddressDiscontentHandler } from "@/lib/onePartyState/decisionEvents/stage1AddressDiscontent";
import type { DecisionContext } from "@/lib/onePartyState/decisionEvents/types";
import type { LeaderDecision } from "@/lib/db/types/regimeEscalation";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

function makeLeaderState(partyConfidence = 75, popularLegitimacy = 75): CountryLeaderState {
  return {
    _id: "CN_stub",
    countryId: "CN",
    leaderCharacterId: new ObjectId(),
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(db: MockDb): DecisionContext {
  const leaderId = new ObjectId();
  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: "stage1.addressDiscontent",
    offeredAtTurn: 100,
    expiresAtTurn: 148,
    leaderCharacterId: leaderId,
    payload: {},
  };
  return {
    db: db as unknown as Db,
    countryId: "CN",
    currentTurn: 100,
    decision,
    leaderCharacterId: leaderId,
  };
}

describe("stage1AddressDiscontent handler", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryLeaderStates");
    db.collection("rulingPartyPurgeEvents");
    db.collection("regimeEscalation");
    db.collection("countryState");
    // adjustLeaderConfidence + adjustPopularLegitimacy expect an existing
    // leader-state doc to drive the findOneAndUpdate.
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryLeaderStates.findOneAndUpdate.mockResolvedValue(makeLeaderState());
  });

  it("registers as kind 'stage1.addressDiscontent' with 3 options + ignore default", () => {
    expect(stage1AddressDiscontentHandler.kind).toBe("stage1.addressDiscontent");
    const ids = stage1AddressDiscontentHandler.options.map((o) => o.id);
    expect(ids).toEqual(["acknowledge", "crackDown", "ignore"]);
    expect(stage1AddressDiscontentHandler.defaultOptionId).toBe("ignore");
  });

  it("acknowledge: -2 intra-party, +3 popular, sets half-cost discount on countryState", async () => {
    const ctx = makeContext(db);
    const option = stage1AddressDiscontentHandler.options.find((o) => o.id === "acknowledge")!;

    await option.apply(ctx);

    // Two findOneAndUpdate calls on countryLeaderStates (confidence + popular)
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalledTimes(2);

    // updateOne on countryState wrote the half-cost discount
    const countryStateCalls = db.collectionMocks.countryState.updateOne.mock.calls;
    expect(countryStateCalls).toHaveLength(1);
    const set = (
      countryStateCalls[0][1] as {
        $set: { pendingReformDiscount: { turn: number; multiplier: number } };
      }
    ).$set;
    expect(set.pendingReformDiscount).toEqual({ turn: 100, multiplier: 0.5 });
  });

  it("crackDown: -1 popular, records a minor purge, sets 0.5x popular decay for 24 turns", async () => {
    const ctx = makeContext(db);
    const option = stage1AddressDiscontentHandler.options.find((o) => o.id === "crackDown")!;

    await option.apply(ctx);

    // adjustPopularLegitimacy uses findOneAndUpdate on countryLeaderStates
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalled();
    // Purge event inserted
    expect(db.collectionMocks.rulingPartyPurgeEvents.insertOne).toHaveBeenCalledTimes(1);
    const purge = db.collectionMocks.rulingPartyPurgeEvents.insertOne.mock.calls[0][0] as {
      severity: string;
      kind: string;
    };
    expect(purge.severity).toBe("minor");
    expect(purge.kind).toBe("discipline");
    // Popular decay modifier set on regimeEscalation
    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    expect(escCalls).toHaveLength(1);
    const set = (
      escCalls[0][1] as {
        $set: { popularDecayModifier: { multiplier: number; untilTurn: number } };
      }
    ).$set;
    expect(set.popularDecayModifier).toEqual({ multiplier: 0.5, untilTurn: 124 });
  });

  it("ignore: sets 1.25x popular decay + bumps stage1 dwell by 2", async () => {
    const ctx = makeContext(db);
    const option = stage1AddressDiscontentHandler.options.find((o) => o.id === "ignore")!;

    await option.apply(ctx);

    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    expect(escCalls).toHaveLength(2); // decay modifier + dwell bump

    const decayCall = escCalls.find((c) => {
      const op = c[1] as { $set?: { popularDecayModifier?: unknown } };
      return op.$set?.popularDecayModifier !== undefined;
    });
    expect(decayCall).toBeDefined();
    const decaySet = (
      decayCall![1] as {
        $set: { popularDecayModifier: { multiplier: number; untilTurn: number } };
      }
    ).$set;
    expect(decaySet.popularDecayModifier).toEqual({ multiplier: 1.25, untilTurn: 124 });

    const incCall = escCalls.find((c) => {
      const op = c[1] as { $inc?: unknown };
      return op.$inc !== undefined;
    });
    expect(incCall).toBeDefined();
    const inc = (incCall![1] as { $inc: { "dwellCounters.stage1": number } }).$inc;
    expect(inc["dwellCounters.stage1"]).toBe(2);
  });
});
