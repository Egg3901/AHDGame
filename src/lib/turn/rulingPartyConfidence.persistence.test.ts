/**
 * Integration tests for ruling-party confidence persistence helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  installNewLeader,
  renewLeaderMandate,
  adjustLeaderConfidence,
  INITIAL_CONFIDENCE,
  MAX_CONFIDENCE,
} from "@/lib/turn/rulingPartyConfidence";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

function makeMockDb() {
  const docs: Map<string, CountryLeaderState> = new Map();

  // Helper to deep-clone while preserving ObjectId instances
  function cloneDoc(doc: CountryLeaderState): CountryLeaderState {
    return {
      ...doc,
      _id: doc._id,
      leaderCharacterId: new ObjectId(doc.leaderCharacterId.toString()),
      confidenceHistory: doc.confidenceHistory.map((h) => ({ ...h, at: new Date(h.at) })),
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };
  }

  const collection = {
    findOne: vi.fn().mockImplementation((filter: { _id?: string }) => {
      const doc = filter._id ? (docs.get(filter._id) ?? null) : null;
      return Promise.resolve(doc ? cloneDoc(doc) : null);
    }),
    replaceOne: vi.fn().mockImplementation((filter: { _id: string }, doc: CountryLeaderState) => {
      docs.set(filter._id, cloneDoc(doc));
      return Promise.resolve({ modifiedCount: 1, upsertedCount: 1 });
    }),
    findOneAndUpdate: vi
      .fn()
      .mockImplementation(
        (
          filter: { _id: string },
          update: { $set?: Partial<CountryLeaderState>; $inc?: Record<string, number> },
          _opts?: unknown
        ) => {
          const existing = docs.get(filter._id);
          if (!existing) return Promise.resolve(null);
          const clone: CountryLeaderState = cloneDoc(existing);
          if (update.$set) {
            Object.assign(clone, update.$set);
          }
          if (update.$inc) {
            const indexable = clone as unknown as Record<string, number>;
            for (const [key, val] of Object.entries(update.$inc)) {
              indexable[key] = (indexable[key] ?? 0) + val;
            }
          }
          docs.set(filter._id, clone);
          return Promise.resolve(clone);
        }
      ),
  };

  return {
    collection,
    docs,
    db: {
      collection: vi.fn().mockReturnValue(collection),
    } as unknown as import("mongodb").Db,
  };
}

describe("Ruling-party confidence persistence", () => {
  const countryId = "CN";
  const leaderId = new ObjectId();
  const otherLeaderId = new ObjectId();
  const officeType = "premier";
  const partyId = "1"; // CPC

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("installNewLeader", () => {
    it("creates a new leader with confidence 75", async () => {
      const { db, docs } = makeMockDb();
      const state = await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      expect(state.partyConfidence).toBe(INITIAL_CONFIDENCE);
      expect(state.startedAtTurn).toBe(10);
      expect(state.lastRenewedAtTurn).toBeNull();
      expect(state.renewalCount).toBe(0);
      expect(docs.has(`${countryId}_${leaderId.toString()}`)).toBe(true);
    });

    it("overwrites an existing state for the same leader", async () => {
      const { db, docs } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 5);
      const state2 = await installNewLeader(db, countryId, leaderId, officeType, partyId, 20);
      expect(state2.partyConfidence).toBe(INITIAL_CONFIDENCE);
      expect(state2.startedAtTurn).toBe(20);
      expect(docs.size).toBe(1);
    });
  });

  describe("renewLeaderMandate", () => {
    it("installs new leader when no prior state exists", async () => {
      const { db } = makeMockDb();
      const { state, bumped } = await renewLeaderMandate(
        db,
        countryId,
        leaderId,
        officeType,
        partyId,
        10
      );
      expect(state.partyConfidence).toBe(INITIAL_CONFIDENCE);
      expect(bumped).toBe(false);
    });

    it("bumps confidence by +5 for same leader renewal", async () => {
      const { db } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      const { state, bumped } = await renewLeaderMandate(
        db,
        countryId,
        leaderId,
        officeType,
        partyId,
        20
      );
      expect(state.partyConfidence).toBe(INITIAL_CONFIDENCE + 5);
      expect(state.lastRenewedAtTurn).toBe(20);
      expect(state.renewalCount).toBe(1);
      expect(bumped).toBe(true);
    });

    it("caps confidence at MAX_CONFIDENCE (95) on renewal", async () => {
      const { db, docs } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      // Simulate high confidence by mutating the stored doc directly
      const id = `CN_${leaderId.toString()}`;
      const stored = docs.get(id);
      if (stored) stored.partyConfidence = 92;
      const { state, bumped } = await renewLeaderMandate(
        db,
        countryId,
        leaderId,
        officeType,
        partyId,
        20
      );
      expect(state.partyConfidence).toBe(MAX_CONFIDENCE);
      expect(bumped).toBe(true);
    });

    it("is idempotent: second renewal on same turn is no-op", async () => {
      const { db } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      const first = await renewLeaderMandate(db, countryId, leaderId, officeType, partyId, 20);
      expect(first.bumped).toBe(true);
      const second = await renewLeaderMandate(db, countryId, leaderId, officeType, partyId, 20);
      expect(second.bumped).toBe(false);
      expect(second.state.partyConfidence).toBe(first.state.partyConfidence);
    });

    it("resets to 75 when a different leader takes over", async () => {
      const { db } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      await renewLeaderMandate(db, countryId, leaderId, officeType, partyId, 20);
      const { state, bumped } = await renewLeaderMandate(
        db,
        countryId,
        otherLeaderId,
        officeType,
        partyId,
        30
      );
      expect(state.partyConfidence).toBe(INITIAL_CONFIDENCE);
      expect(state.startedAtTurn).toBe(30);
      expect(bumped).toBe(false);
    });
  });

  describe("adjustLeaderConfidence", () => {
    it("adjusts confidence by delta and records history", async () => {
      const { db } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      const state = await adjustLeaderConfidence(
        db,
        countryId,
        leaderId,
        -10,
        "Policy misalignment",
        15
      );
      expect(state).not.toBeNull();
      expect(state!.partyConfidence).toBe(INITIAL_CONFIDENCE - 10);
      expect(state!.confidenceHistory.length).toBe(1);
      expect(state!.confidenceHistory[0].delta).toBe(-10);
      expect(state!.confidenceHistory[0].reason).toBe("Policy misalignment");
    });

    it("returns null when no state exists", async () => {
      const { db } = makeMockDb();
      const state = await adjustLeaderConfidence(db, countryId, leaderId, 5, "Test", 10);
      expect(state).toBeNull();
    });

    it("clamps adjusted confidence to valid range", async () => {
      const { db } = makeMockDb();
      await installNewLeader(db, countryId, leaderId, officeType, partyId, 10);
      const low = await adjustLeaderConfidence(db, countryId, leaderId, -100, "Crisis", 15);
      expect(low!.partyConfidence).toBe(0);
      const high = await adjustLeaderConfidence(db, countryId, leaderId, 200, "Surge", 20);
      expect(high!.partyConfidence).toBe(MAX_CONFIDENCE);
    });
  });
});
