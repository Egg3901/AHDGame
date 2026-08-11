import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/time/gameTime", async (importActual) => ({
  // Keep real exports (e.g. hasGameTimePassed, used by isPrimaryEnded's Date
  // fallback) and only stub getGameTime.
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));

import { resolveCanvassState } from "./eligibility";
import type { Character, ElectionCandidate, Election } from "@/lib/db/types";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    homeState: "GA",
    ...overrides,
  } as Character;
}

function mockCandidacy(
  db: MockDb,
  candidate: Partial<ElectionCandidate>,
  election: Partial<Election>
) {
  const electionId = election._id ?? new ObjectId();
  const candidateDoc = {
    _id: new ObjectId(),
    electionId,
    characterId: candidate.characterId ?? new ObjectId(),
    status: "active",
    ...candidate,
  } as ElectionCandidate;
  const electionDoc = {
    _id: electionId,
    electionType: "president",
    status: "active",
    ...election,
  } as Election;

  db.collection("electionCandidates").find.mockReturnValue({
    toArray: () => Promise.resolve([candidateDoc]),
  });
  db.collection("elections").find.mockReturnValue({
    toArray: () => Promise.resolve([electionDoc]),
  });
}

describe("resolveCanvassState", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    });
  });

  it("falls back to home state when the character has no presidential candidacy", async () => {
    const character = makeCharacter({ homeState: "GA" });

    const result = await resolveCanvassState(db as unknown as Db, character);

    expect(result).toEqual({ ok: true, stateId: "GA", source: "home" });
  });

  describe("primary phase", () => {
    it("returns primaryCampaignState when set", async () => {
      const character = makeCharacter();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      mockCandidacy(
        db,
        { characterId: character._id, primaryCampaignState: "TX" },
        { primaryEndTime: future }
      );

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: true, stateId: "TX", source: "primaryCampaign" });
    });

    it("returns needs_primary_campaign when not set", async () => {
      const character = makeCharacter();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      mockCandidacy(db, { characterId: character._id }, { primaryEndTime: future });

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: false, reason: "needs_primary_campaign" });
    });
  });

  describe("general phase", () => {
    it("returns travelState when set and primary has ended", async () => {
      const character = makeCharacter();
      const past = new Date(Date.now() - 60 * 60 * 1000);
      mockCandidacy(
        db,
        { characterId: character._id, travelState: "PA" },
        { primaryEndTime: past }
      );

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: true, stateId: "PA", source: "travel" });
    });

    it("returns travelState when there is no primary at all", async () => {
      const character = makeCharacter();
      mockCandidacy(db, { characterId: character._id, travelState: "FL" }, {});

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: true, stateId: "FL", source: "travel" });
    });

    it("returns needs_travel when travelState is not set", async () => {
      const character = makeCharacter();
      const past = new Date(Date.now() - 60 * 60 * 1000);
      mockCandidacy(db, { characterId: character._id }, { primaryEndTime: past });

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: false, reason: "needs_travel" });
    });
  });

  describe("edge cases", () => {
    it("ignores withdrawn candidacies and falls back to home state", async () => {
      const character = makeCharacter({ homeState: "OR" });
      db.collection("electionCandidates").find.mockReturnValue({
        toArray: () => Promise.resolve([]),
      });

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: true, stateId: "OR", source: "home" });
    });

    it("falls back to home state when the only presidential election is no longer active", async () => {
      const character = makeCharacter({ homeState: "OR" });
      const candidateDoc = {
        _id: new ObjectId(),
        electionId: new ObjectId(),
        characterId: character._id,
        status: "active",
      } as ElectionCandidate;
      db.collection("electionCandidates").find.mockReturnValue({
        toArray: () => Promise.resolve([candidateDoc]),
      });
      db.collection("elections").find.mockReturnValue({
        toArray: () => Promise.resolve([]),
      });

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: true, stateId: "OR", source: "home" });
    });

    it("presidential candidacy takes precedence over a coexisting non-presidential candidacy", async () => {
      const character = makeCharacter({ homeState: "GA" });
      const presidentialId = new ObjectId();
      const governorId = new ObjectId();
      const past = new Date(Date.now() - 60 * 60 * 1000);

      db.collection("electionCandidates").find.mockReturnValue({
        toArray: () =>
          Promise.resolve([
            {
              _id: new ObjectId(),
              electionId: presidentialId,
              characterId: character._id,
              status: "active",
              travelState: "TX",
            },
            {
              _id: new ObjectId(),
              electionId: governorId,
              characterId: character._id,
              status: "active",
            },
          ] as ElectionCandidate[]),
      });
      db.collection("elections").find.mockReturnValue({
        toArray: () =>
          Promise.resolve([
            {
              _id: presidentialId,
              electionType: "president",
              status: "active",
              primaryEndTime: past,
            },
          ] as Election[]),
      });

      const result = await resolveCanvassState(db as unknown as Db, character);

      expect(result).toEqual({ ok: true, stateId: "TX", source: "travel" });
    });
  });
});
