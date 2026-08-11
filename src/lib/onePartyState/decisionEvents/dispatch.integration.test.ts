/**
 * End-to-end integration check: the decisionEvents barrel registers
 * every Phase-4 handler, and `resolveActiveDecision` applies the
 * chosen option's effects + promotes the queue head atomically.
 *
 * Scenario walked: a leader is staring at an active Stage-1 decision;
 * they pick "acknowledge"; the registry fires the handler, which
 * adjusts confidence + popular + writes the half-cost discount; the
 * queue slot clears.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import "@/lib/onePartyState/decisionEvents"; // registration side-effect
import { resolveActiveDecision } from "@/lib/onePartyState/decisionQueue";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";
import type { EscalationState, LeaderDecision } from "@/lib/db/types/regimeEscalation";

function makeLeaderState(): CountryLeaderState {
  return {
    _id: "CN_stub",
    countryId: "CN",
    leaderCharacterId: new ObjectId(),
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence: 50,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: 55,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeEscalationStateWithActiveStage1(
  leaderId: ObjectId,
  currentTurn: number
): EscalationState {
  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: "stage1.addressDiscontent",
    offeredAtTurn: currentTurn,
    expiresAtTurn: currentTurn + 48,
    leaderCharacterId: leaderId,
    payload: {},
  };
  return {
    _id: "CN",
    countryId: "CN",
    currentStage: "discontent",
    stageEnteredAtTurn: currentTurn,
    dwellCounters: {
      stage1: 12,
      stage2: { sustained: 0, cumulativeIn168: 0 },
      stage3: 0,
      stage4: 0,
    },
    conventionInProgress: false,
    activeDecision: decision,
    decisionQueue: [],
    transitionHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("decision-events dispatch (integration)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("regimeEscalation");
    db.collection("countryLeaderStates");
    db.collection("countryState");
    db.collection("rulingPartyPurgeEvents");
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryLeaderStates.findOneAndUpdate.mockResolvedValue(makeLeaderState());
  });

  it("resolveActiveDecision('acknowledge') fires the Stage-1 handler and clears the queue slot", async () => {
    const leaderId = new ObjectId();
    const escState = makeEscalationStateWithActiveStage1(leaderId, 100);
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(escState);

    await resolveActiveDecision(db as unknown as Db, "CN", "acknowledge", 100);

    // 1. Stage-1 acknowledge: two adjustments on countryLeaderStates
    //    (confidence -2 + popular +3, both via findOneAndUpdate).
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalledTimes(2);

    // 2. Half-cost reform discount written to countryState.
    const stateCalls = db.collectionMocks.countryState.updateOne.mock.calls;
    expect(stateCalls).toHaveLength(1);
    const discount = (
      stateCalls[0][1] as {
        $set: { pendingReformDiscount: { turn: number; multiplier: number } };
      }
    ).$set.pendingReformDiscount;
    expect(discount).toEqual({ turn: 100, multiplier: 0.5 });

    // 3. Queue promoted: activeDecision cleared (queue was empty so next is null).
    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const promoteCall = escCalls.find((c) => {
      const op = c[1] as { $set?: { activeDecision?: unknown } };
      return op.$set && "activeDecision" in op.$set;
    });
    expect(promoteCall).toBeDefined();
    const set = (
      promoteCall![1] as {
        $set: { activeDecision: unknown; decisionQueue: unknown[] };
      }
    ).$set;
    expect(set.activeDecision).toBeNull();
    expect(set.decisionQueue).toEqual([]);
  });
});
