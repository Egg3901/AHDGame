import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stage3RespondToFactionSplitHandler } from "@/lib/onePartyState/decisionEvents/stage3RespondToFactionSplit";
import type { DecisionContext } from "@/lib/onePartyState/decisionEvents/types";
import type { LeaderDecision } from "@/lib/db/types/regimeEscalation";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

function makeLeaderState(): CountryLeaderState {
  return {
    _id: "CN_stub",
    countryId: "CN",
    leaderCharacterId: new ObjectId(),
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence: 12,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: 20,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(db: MockDb, payload: Record<string, unknown> = {}): DecisionContext {
  const leaderId = new ObjectId();
  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: "stage3.respondToFactionSplit",
    offeredAtTurn: 300,
    expiresAtTurn: 348,
    leaderCharacterId: leaderId,
    payload,
  };
  return {
    db: db as unknown as Db,
    countryId: "CN",
    currentTurn: 300,
    decision,
    leaderCharacterId: leaderId,
  };
}

describe("stage3RespondToFactionSplit handler", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryLeaderStates");
    db.collection("rulingPartyPurgeEvents");
    db.collection("regimeEscalation");
    db.collection("politicalParties");
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("countryState");
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryLeaderStates.findOneAndUpdate.mockResolvedValue(makeLeaderState());
  });

  it("registers as 'stage3.respondToFactionSplit' with 4 options + ignore default", () => {
    expect(stage3RespondToFactionSplitHandler.kind).toBe("stage3.respondToFactionSplit");
    expect(stage3RespondToFactionSplitHandler.options.map((o) => o.id)).toEqual([
      "negotiate",
      "purgeDefectors",
      "concedeLeadership",
      "ignore",
    ]);
    expect(stage3RespondToFactionSplitHandler.defaultOptionId).toBe("ignore");
  });

  it("negotiate: requires defectedPartySequentialId in payload", async () => {
    const ctx = makeContext(db, {}); // no payload
    const option = stage3RespondToFactionSplitHandler.options.find((o) => o.id === "negotiate")!;
    await expect(option.apply(ctx)).rejects.toThrow(/defectedPartySequentialId/);
  });

  it("negotiate: -4 intra, +8 popular, re-merges defectors, bans empty defected party, resets stage3 dwell", async () => {
    const ctx = makeContext(db, { defectedPartySequentialId: 7 });
    const option = stage3RespondToFactionSplitHandler.options.find((o) => o.id === "negotiate")!;

    await option.apply(ctx);

    // Two findOneAndUpdate calls on leader-state (confidence + popular)
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalledTimes(2);

    // characters.updateMany: defected → ruling (CN's seeded rulingPartyId is 1)
    const charCalls = db.collectionMocks.characters.updateMany.mock.calls;
    expect(charCalls).toHaveLength(1);
    const charFilter = charCalls[0][0] as { party: string; countryId: string };
    expect(charFilter.party).toBe("7");
    expect(charFilter.countryId).toBe("CN");
    const charSet = (charCalls[0][1] as { $set: { party: string } }).$set;
    expect(charSet.party).toBe("1");

    // electedOfficials.updateMany: same re-assignment
    const eoCalls = db.collectionMocks.electedOfficials.updateMany.mock.calls;
    expect(eoCalls).toHaveLength(1);
    const eoSet = (eoCalls[0][1] as { $set: { party: string } }).$set;
    expect(eoSet.party).toBe("1");

    // politicalParties.updateOne: defected party flipped to banned, memberCount 0
    const partyCalls = db.collectionMocks.politicalParties.updateOne.mock.calls;
    expect(partyCalls).toHaveLength(1);
    const partyFilter = partyCalls[0][0] as { sequentialId: number };
    expect(partyFilter.sequentialId).toBe(7);
    const partySet = (partyCalls[0][1] as { $set: { regimeStatus: string; memberCount: number } })
      .$set;
    expect(partySet.regimeStatus).toBe("banned");
    expect(partySet.memberCount).toBe(0);

    // regimeEscalation: stage3 dwell reset to 0
    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const resetCall = escCalls.find((c) => {
      const op = c[1] as { $set?: Record<string, unknown> };
      return op.$set?.["dwellCounters.stage3"] === 0;
    });
    expect(resetCall).toBeDefined();
  });

  it("purgeDefectors: requires defectedPartySequentialId in payload", async () => {
    const ctx = makeContext(db, {});
    const option = stage3RespondToFactionSplitHandler.options.find(
      (o) => o.id === "purgeDefectors"
    )!;
    await expect(option.apply(ctx)).rejects.toThrow(/defectedPartySequentialId/);
  });

  it("purgeDefectors: extreme faction purge + bans the defected party", async () => {
    const ctx = makeContext(db, { defectedPartySequentialId: 9 });
    const option = stage3RespondToFactionSplitHandler.options.find(
      (o) => o.id === "purgeDefectors"
    )!;

    await option.apply(ctx);

    // Extreme-severity faction purge inserted
    const purgeInsert = db.collectionMocks.rulingPartyPurgeEvents.insertOne.mock.calls[0][0] as {
      severity: string;
      kind: string;
    };
    expect(purgeInsert.severity).toBe("extreme");
    expect(purgeInsert.kind).toBe("faction");

    // politicalParties.updateOne: defected party flipped to banned
    const partyCalls = db.collectionMocks.politicalParties.updateOne.mock.calls;
    expect(partyCalls).toHaveLength(1);
    const filter = partyCalls[0][0] as { sequentialId: number; regimeStatus: string };
    expect(filter.sequentialId).toBe(9);
    expect(filter.regimeStatus).toBe("approved");
    const set = (partyCalls[0][1] as { $set: { regimeStatus: string } }).$set;
    expect(set.regimeStatus).toBe("banned");
  });

  it("concedeLeadership: requires defectedPartySequentialId in payload", async () => {
    const ctx = makeContext(db, {});
    const option = stage3RespondToFactionSplitHandler.options.find(
      (o) => o.id === "concedeLeadership"
    )!;
    await expect(option.apply(ctx)).rejects.toThrow(/defectedPartySequentialId/);
  });

  it("concedeLeadership: throws if no character in defected party", async () => {
    const ctx = makeContext(db, { defectedPartySequentialId: 11 });
    // characters.findOne returns null by default — no successor found
    const option = stage3RespondToFactionSplitHandler.options.find(
      (o) => o.id === "concedeLeadership"
    )!;
    await expect(option.apply(ctx)).rejects.toThrow(/no character found in defected party/);
  });

  it("concedeLeadership: installs successor, promotes defected party to ruling, +5 popular, resets dwell", async () => {
    const successorId = new ObjectId();
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: successorId,
      party: "11",
      countryId: "CN",
    });
    // updateCountryState reads + patches; the mock has to return the
    // post-patch doc so the helper doesn't throw "no countryState".
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue({
      _id: "CN",
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 11,
      opsVoteMultipliers: null,
      hasLeaderConfidenceModel: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ctx = makeContext(db, { defectedPartySequentialId: 11 });
    const option = stage3RespondToFactionSplitHandler.options.find(
      (o) => o.id === "concedeLeadership"
    )!;
    await option.apply(ctx);

    // politicalParties: prior ruling (id=1 from CN seed) → approved, defected (11) → ruling
    const partyCalls = db.collectionMocks.politicalParties.updateOne.mock.calls;
    expect(partyCalls).toHaveLength(2);
    const demoteCall = partyCalls.find((c) => {
      const f = c[0] as { sequentialId: number };
      return f.sequentialId === 1;
    });
    expect(demoteCall).toBeDefined();
    const demoteSet = (demoteCall![1] as { $set: { regimeStatus: string } }).$set;
    expect(demoteSet.regimeStatus).toBe("approved");

    const promoteCall = partyCalls.find((c) => {
      const f = c[0] as { sequentialId: number };
      return f.sequentialId === 11;
    });
    expect(promoteCall).toBeDefined();
    const promoteSet = (promoteCall![1] as { $set: { regimeStatus: string } }).$set;
    expect(promoteSet.regimeStatus).toBe("ruling");

    // countryState patched with new rulingPartyId
    const stateCalls = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    expect(stateCalls.length).toBeGreaterThanOrEqual(1);
    const patchCall = stateCalls.find((c) => {
      const op = c[1] as { $set?: { rulingPartyId?: number } };
      return op.$set?.rulingPartyId === 11;
    });
    expect(patchCall).toBeDefined();

    // installNewLeader → replaceOne on countryLeaderStates with INITIAL_CONFIDENCE=75
    const replaceCalls = db.collectionMocks.countryLeaderStates.replaceOne.mock.calls;
    expect(replaceCalls).toHaveLength(1);
    const newLeaderState = replaceCalls[0][1] as {
      leaderCharacterId: ObjectId;
      partyConfidence: number;
      governingPartyId: string | null;
    };
    expect(newLeaderState.leaderCharacterId).toBe(successorId);
    expect(newLeaderState.partyConfidence).toBe(75);
    expect(newLeaderState.governingPartyId).toBe("11");

    // regimeEscalation: stage3 dwell reset to 0
    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const resetCall = escCalls.find((c) => {
      const op = c[1] as { $set?: Record<string, unknown> };
      return op.$set?.["dwellCounters.stage3"] === 0;
    });
    expect(resetCall).toBeDefined();
  });

  it("ignore: no-op (no DB writes)", async () => {
    const ctx = makeContext(db);
    const option = stage3RespondToFactionSplitHandler.options.find((o) => o.id === "ignore")!;
    await option.apply(ctx);

    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collectionMocks.rulingPartyPurgeEvents.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.politicalParties.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
