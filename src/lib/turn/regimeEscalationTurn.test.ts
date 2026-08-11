import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processRegimeEscalationTurn } from "@/lib/turn/regimeEscalationTurn";
import type { EscalationState } from "@/lib/db/types/regimeEscalation";

function seedEscalation(overrides: Partial<EscalationState> = {}): EscalationState {
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

describe("processRegimeEscalationTurn", () => {
  let db: MockDb;
  const leaderId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("regimeEscalation");
  });

  it("self-heals a stable row on first tick when no doc exists", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(null);

    const result = await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 80,
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 1,
    });

    expect(db.collectionMocks.regimeEscalation.insertOne).toHaveBeenCalled();
    expect(result?.fromStage).toBe("stable");
    expect(result?.toStage).toBe("stable");
  });

  it("updates dwell counters every turn even when stage doesn't change", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      seedEscalation({
        currentStage: "stable",
        dwellCounters: {
          stage1: 5,
          stage2: { sustained: 0, cumulativeIn168: 0 },
          stage3: 0,
          stage4: 0,
        },
      })
    );

    await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 55, // ≤ 60 → stage1 increments
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 10,
    });

    const call = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls[0];
    const set = (call[1] as { $set: { dwellCounters: { stage1: number } } }).$set;
    expect(set.dwellCounters.stage1).toBe(6);
  });

  it("fires a transition + offers a decision when stage advances", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      seedEscalation({
        currentStage: "stable",
        dwellCounters: {
          stage1: 12, // already at threshold; will trigger transition this turn
          stage2: { sustained: 0, cumulativeIn168: 0 },
          stage3: 0,
          stage4: 0,
        },
      })
    );

    const result = await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 50,
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 20,
    });

    expect(result?.fromStage).toBe("stable");
    expect(result?.toStage).toBe("discontent");
    expect(result?.decisionOffered).toBe(true);

    // Should have written a transition entry + offered a decision.
    // First findOneAndUpdate = stage transition + history. Second = offerDecision.
    expect(
      db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls.length
    ).toBeGreaterThanOrEqual(2);
  });

  it("does NOT offer a decision when stage stays the same", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      seedEscalation({ currentStage: "stable" })
    );

    const result = await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 80,
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 10,
    });

    expect(result?.decisionOffered).toBe(false);
  });

  it("writes a country-history event on stage transition", async () => {
    db.collection("countryHistory");
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      seedEscalation({
        currentStage: "stable",
        dwellCounters: {
          stage1: 12,
          stage2: { sustained: 0, cumulativeIn168: 0 },
          stage3: 0,
          stage4: 0,
        },
      })
    );

    await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 50,
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 20,
    });

    const inserts = db.collectionMocks.countryHistory.insertOne.mock.calls;
    expect(inserts.length).toBeGreaterThan(0);
    const event = inserts[0][0] as {
      eventType: string;
      title: string;
      details?: { from?: string; to?: string };
    };
    expect(event.eventType).toBe("regime_escalation");
    expect(event.details?.from).toBe("stable");
    expect(event.details?.to).toBe("discontent");
    expect(event.title).toMatch(/discontent grows in CN/i);
  });

  it("does NOT write a country-history event when stage stays the same", async () => {
    db.collection("countryHistory");
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      seedEscalation({ currentStage: "stable" })
    );

    await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 80,
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 10,
    });

    expect(db.collectionMocks.countryHistory.insertOne).not.toHaveBeenCalled();
  });

  it("expires timed-out active decisions before computing transitions", async () => {
    db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
      seedEscalation({
        currentStage: "discontent",
        activeDecision: {
          id: new ObjectId(),
          kind: "stage1.addressDiscontent",
          offeredAtTurn: 10,
          expiresAtTurn: 58,
          leaderCharacterId: leaderId,
          payload: {},
        },
        decisionQueue: [],
      })
    );

    await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy: 80,
      partyConfidence: 80,
      rulingLeaderCharacterId: leaderId,
      currentTurn: 100, // past expiry
    });

    // First findOneAndUpdate is the expire (clears activeDecision)
    expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).toHaveBeenCalled();
  });
});
