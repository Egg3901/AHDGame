import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stage2RespondToUnrestHandler } from "@/lib/onePartyState/decisionEvents/stage2RespondToUnrest";
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
    partyConfidence: 50,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: 30,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(db: MockDb, payload: Record<string, unknown> = {}): DecisionContext {
  const leaderId = new ObjectId();
  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: "stage2.respondToUnrest",
    offeredAtTurn: 200,
    expiresAtTurn: 248,
    leaderCharacterId: leaderId,
    payload,
  };
  return {
    db: db as unknown as Db,
    countryId: "CN",
    currentTurn: 200,
    decision,
    leaderCharacterId: leaderId,
  };
}

describe("stage2RespondToUnrest handler", () => {
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

  it("registers as 'stage2.respondToUnrest' with 4 options + ignore default", () => {
    expect(stage2RespondToUnrestHandler.kind).toBe("stage2.respondToUnrest");
    expect(stage2RespondToUnrestHandler.options.map((o) => o.id)).toEqual([
      "openDialogue",
      "selectiveConcession",
      "martialLaw",
      "ignore",
    ]);
    expect(stage2RespondToUnrestHandler.defaultOptionId).toBe("ignore");
  });

  it("openDialogue: -3 intra-party, +6 popular, sets 2x dwell decay for 48 turns", async () => {
    const ctx = makeContext(db);
    const option = stage2RespondToUnrestHandler.options.find((o) => o.id === "openDialogue")!;
    await option.apply(ctx);

    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const boostCall = escCalls.find((c) => {
      const op = c[1] as { $set?: { stage2DwellDecayBoost?: unknown } };
      return op.$set?.stage2DwellDecayBoost !== undefined;
    });
    expect(boostCall).toBeDefined();
    const set = (
      boostCall![1] as {
        $set: { stage2DwellDecayBoost: { multiplier: number; untilTurn: number } };
      }
    ).$set;
    expect(set.stage2DwellDecayBoost).toEqual({ multiplier: 2, untilTurn: 248 });
  });

  it("selectiveConcession: requires bannedPartyId in payload", async () => {
    const ctx = makeContext(db, {}); // no payload
    const option = stage2RespondToUnrestHandler.options.find(
      (o) => o.id === "selectiveConcession"
    )!;
    await expect(option.apply(ctx)).rejects.toThrow(/bannedPartyId/);
  });

  it("selectiveConcession: legalizes the supplied party, applies costs", async () => {
    const ctx = makeContext(db, { bannedPartyId: 5 });
    const option = stage2RespondToUnrestHandler.options.find(
      (o) => o.id === "selectiveConcession"
    )!;
    await option.apply(ctx);

    const updateCalls = db.collectionMocks.politicalParties.updateOne.mock.calls;
    expect(updateCalls).toHaveLength(1);
    const filter = updateCalls[0][0] as { sequentialId: number; regimeStatus: string };
    expect(filter.sequentialId).toBe(5);
    expect(filter.regimeStatus).toBe("banned");
    const set = (updateCalls[0][1] as { $set: { regimeStatus: string } }).$set;
    expect(set.regimeStatus).toBe("approved");
  });

  it("martialLaw: -8 popular, records an extreme purge, freezes popular decay + blocks stage3", async () => {
    const ctx = makeContext(db);
    const option = stage2RespondToUnrestHandler.options.find((o) => o.id === "martialLaw")!;
    await option.apply(ctx);

    const purgeInsert = db.collectionMocks.rulingPartyPurgeEvents.insertOne.mock.calls[0][0] as {
      severity: string;
    };
    expect(purgeInsert.severity).toBe("extreme");

    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    const decayCall = escCalls.find((c) => {
      const op = c[1] as { $set?: { popularDecayModifier?: { multiplier: number } } };
      return op.$set?.popularDecayModifier?.multiplier === 0;
    });
    expect(decayCall).toBeDefined();
    const blockCall = escCalls.find((c) => {
      const op = c[1] as { $set?: { stage3Block?: unknown } };
      return op.$set?.stage3Block !== undefined;
    });
    expect(blockCall).toBeDefined();
  });

  it("ignore: sets 1.5x popular decay for 48 turns", async () => {
    const ctx = makeContext(db);
    const option = stage2RespondToUnrestHandler.options.find((o) => o.id === "ignore")!;
    await option.apply(ctx);

    const escCalls = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls;
    expect(escCalls).toHaveLength(1);
    const set = (
      escCalls[0][1] as {
        $set: { popularDecayModifier: { multiplier: number; untilTurn: number } };
      }
    ).$set;
    expect(set.popularDecayModifier).toEqual({ multiplier: 1.5, untilTurn: 248 });
  });
});
