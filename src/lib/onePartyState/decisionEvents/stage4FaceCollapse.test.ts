import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stage4FaceCollapseHandler } from "@/lib/onePartyState/decisionEvents/stage4FaceCollapse";
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
    partyConfidence: 10,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: 12,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(db: MockDb): DecisionContext {
  const leaderId = new ObjectId();
  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: "stage4.faceCollapse",
    offeredAtTurn: 400,
    expiresAtTurn: 448,
    leaderCharacterId: leaderId,
    payload: {},
  };
  return {
    db: db as unknown as Db,
    countryId: "CN",
    currentTurn: 400,
    decision,
    leaderCharacterId: leaderId,
  };
}

describe("stage4FaceCollapse handler", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryLeaderStates");
    db.collection("rulingPartyPurgeEvents");
    db.collection("regimeEscalation");
    db.collection("politicalParties");
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryLeaderStates.findOneAndUpdate.mockResolvedValue(makeLeaderState());
  });

  it("registers as 'stage4.faceCollapse' with 2 options + acceptPeacefully default", () => {
    expect(stage4FaceCollapseHandler.kind).toBe("stage4.faceCollapse");
    expect(stage4FaceCollapseHandler.options.map((o) => o.id)).toEqual([
      "resist",
      "acceptPeacefully",
    ]);
    expect(stage4FaceCollapseHandler.defaultOptionId).toBe("acceptPeacefully");
  });

  it("resist: -25 intra, -20 popular, extreme faction purge, bans all approved parties, sets stage4Delay", async () => {
    const ctx = makeContext(db);
    const option = stage4FaceCollapseHandler.options.find((o) => o.id === "resist")!;

    await option.apply(ctx);

    // adjustLeaderConfidence + adjustPopularLegitimacy → two findOneAndUpdate on leaderStates
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalledTimes(2);

    // Extreme-severity faction purge
    const purgeInsert = db.collectionMocks.rulingPartyPurgeEvents.insertOne.mock.calls[0][0] as {
      severity: string;
      kind: string;
    };
    expect(purgeInsert.severity).toBe("extreme");
    expect(purgeInsert.kind).toBe("faction");

    // Bulk-ban every approved party in the country
    const banCalls = db.collectionMocks.politicalParties.updateMany.mock.calls;
    expect(banCalls).toHaveLength(1);
    const filter = banCalls[0][0] as { countryId: string; regimeStatus: string };
    expect(filter.countryId).toBe("CN");
    expect(filter.regimeStatus).toBe("approved");
    const set = (banCalls[0][1] as { $set: { regimeStatus: string } }).$set;
    expect(set.regimeStatus).toBe("banned");

    // stage4Delay marker on regimeEscalation
    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const delayCall = escCalls.find((c) => {
      const op = c[1] as { $set?: { stage4Delay?: unknown } };
      return op.$set?.stage4Delay !== undefined;
    });
    expect(delayCall).toBeDefined();
    const delaySet = (
      delayCall![1] as {
        $set: { stage4Delay: { untilTurn: number; halveLegacyBonusIfStillBelow15: boolean } };
      }
    ).$set;
    expect(delaySet.stage4Delay).toEqual({
      untilTurn: 448,
      halveLegacyBonusIfStillBelow15: true,
    });
  });

  it("acceptPeacefully: sets conversionPendingAtTurn for Phase 6 to consume", async () => {
    const ctx = makeContext(db);
    const option = stage4FaceCollapseHandler.options.find((o) => o.id === "acceptPeacefully")!;

    await option.apply(ctx);

    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    expect(escCalls).toHaveLength(1);
    const set = (escCalls[0][1] as { $set: { conversionPendingAtTurn: number } }).$set;
    expect(set.conversionPendingAtTurn).toBe(400);

    // No purge, no popular/intra hit on peaceful path
    expect(db.collectionMocks.rulingPartyPurgeEvents.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.politicalParties.updateMany).not.toHaveBeenCalled();
  });
});
