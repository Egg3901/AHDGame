import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  offerDecision,
  resolveActiveDecision,
  expireDecisionsForTurn,
  DECISION_TIMEOUT_TURNS,
} from "@/lib/onePartyState/decisionQueue";
import type { EscalationState, LeaderDecision } from "@/lib/db/types/regimeEscalation";

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

describe("decisionQueue", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("regimeEscalation");
  });

  it("DECISION_TIMEOUT_TURNS is 48", () => {
    expect(DECISION_TIMEOUT_TURNS).toBe(48);
  });

  describe("offerDecision", () => {
    it("sets activeDecision when none pending", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(
        seedEscalation({ activeDecision: null, decisionQueue: [] })
      );

      await offerDecision(db as unknown as Db, "CN", {
        kind: "stage1.addressDiscontent",
        leaderCharacterId: new ObjectId(),
        offeredAtTurn: 100,
        payload: {},
      });

      const call = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls[0];
      const set = (call[1] as { $set: { activeDecision: LeaderDecision } }).$set;
      expect(set.activeDecision.kind).toBe("stage1.addressDiscontent");
      expect(set.activeDecision.offeredAtTurn).toBe(100);
      expect(set.activeDecision.expiresAtTurn).toBe(148); // 100 + 48
    });

    it("pushes to passive queue when a decision is already active", async () => {
      const activeId = new ObjectId();
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(
        seedEscalation({
          activeDecision: {
            id: activeId,
            kind: "stage1.addressDiscontent",
            offeredAtTurn: 90,
            expiresAtTurn: 138,
            leaderCharacterId: new ObjectId(),
            payload: {},
          },
          decisionQueue: [],
        })
      );

      await offerDecision(db as unknown as Db, "CN", {
        kind: "stage2.respondToUnrest",
        leaderCharacterId: new ObjectId(),
        offeredAtTurn: 100,
        payload: {},
      });

      const call = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls[0];
      const op = call[1] as { $push: { decisionQueue: LeaderDecision } };
      expect(op.$push.decisionQueue.kind).toBe("stage2.respondToUnrest");
    });

    it("throws when no escalation state exists for the country", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(null);

      await expect(
        offerDecision(db as unknown as Db, "CN", {
          kind: "stage1.addressDiscontent",
          leaderCharacterId: new ObjectId(),
          offeredAtTurn: 100,
          payload: {},
        })
      ).rejects.toThrow(/no escalation state/i);
    });
  });

  describe("resolveActiveDecision", () => {
    it("clears activeDecision and promotes the queue head", async () => {
      const queuedId = new ObjectId();
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(
        seedEscalation({
          activeDecision: {
            id: new ObjectId(),
            kind: "stage1.addressDiscontent",
            offeredAtTurn: 90,
            expiresAtTurn: 138,
            leaderCharacterId: new ObjectId(),
            payload: {},
          },
          decisionQueue: [
            {
              id: queuedId,
              kind: "stage2.respondToUnrest",
              offeredAtTurn: 95,
              expiresAtTurn: 143,
              leaderCharacterId: new ObjectId(),
              payload: {},
            },
          ],
        })
      );

      await resolveActiveDecision(db as unknown as Db, "CN", "acknowledge", 100);

      const call = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls[0];
      const set = (
        call[1] as {
          $set: { activeDecision: LeaderDecision | null; decisionQueue: LeaderDecision[] };
        }
      ).$set;
      expect(set.activeDecision?.kind).toBe("stage2.respondToUnrest");
      expect(set.decisionQueue).toEqual([]);
    });

    it("clears activeDecision to null when queue is empty", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(
        seedEscalation({
          activeDecision: {
            id: new ObjectId(),
            kind: "stage1.addressDiscontent",
            offeredAtTurn: 90,
            expiresAtTurn: 138,
            leaderCharacterId: new ObjectId(),
            payload: {},
          },
          decisionQueue: [],
        })
      );

      await resolveActiveDecision(db as unknown as Db, "CN", "ignore", 100);

      const call = db.collectionMocks.regimeEscalation.findOneAndUpdate.mock.calls[0];
      const set = (call[1] as { $set: { activeDecision: LeaderDecision | null } }).$set;
      expect(set.activeDecision).toBeNull();
    });

    it("is a no-op when no active decision exists", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValueOnce(
        seedEscalation({ activeDecision: null, decisionQueue: [] })
      );

      await resolveActiveDecision(db as unknown as Db, "CN", "ignore", 100);

      expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("expireDecisionsForTurn", () => {
    it("expires the active decision when current turn ≥ expiresAtTurn", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
        seedEscalation({
          activeDecision: {
            id: new ObjectId(),
            kind: "stage1.addressDiscontent",
            offeredAtTurn: 50,
            expiresAtTurn: 98,
            leaderCharacterId: new ObjectId(),
            payload: {},
          },
          decisionQueue: [],
        })
      );

      await expireDecisionsForTurn(db as unknown as Db, "CN", 100);

      // resolveActiveDecision was called → findOneAndUpdate ran once.
      expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it("does NOT expire decisions that haven't timed out yet", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
        seedEscalation({
          activeDecision: {
            id: new ObjectId(),
            kind: "stage1.addressDiscontent",
            offeredAtTurn: 90,
            expiresAtTurn: 200,
            leaderCharacterId: new ObjectId(),
            payload: {},
          },
          decisionQueue: [],
        })
      );

      await expireDecisionsForTurn(db as unknown as Db, "CN", 100);

      expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("is a no-op when no active decision exists", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(
        seedEscalation({ activeDecision: null, decisionQueue: [] })
      );

      await expireDecisionsForTurn(db as unknown as Db, "CN", 100);

      expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("is a no-op when no escalation state exists", async () => {
      db.collectionMocks.regimeEscalation.findOne.mockResolvedValue(null);

      await expireDecisionsForTurn(db as unknown as Db, "CN", 100);

      expect(db.collectionMocks.regimeEscalation.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
