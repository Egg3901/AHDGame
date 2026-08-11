/**
 * Tests for the first-joiner auto-chair rule in applyCharacterPartyJoin —
 * specifically that a vacant chair seat is NOT handed to a joiner while a
 * chair election is running (the ballot, not join order, decides it).
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { applyCharacterPartyJoin } from "./applyCharacterPartyJoin";
import type { Character, PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/utils/electionCandidacy", () => ({
  withdrawFromMismatchedPrimaries: vi.fn().mockResolvedValue({ withdrawnCount: 0 }),
  cleanupPartyPositionsOnSwitch: vi.fn().mockResolvedValue({
    clearedNationalLeadership: [],
    clearedStateLeadership: [],
    withdrawnStateElections: 0,
    withdrawnNationalElections: 0,
    removedFromCommittee: false,
    withdrawnCommitteeElections: 0,
  }),
}));

vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: vi.fn().mockResolvedValue({
    candidaciesWithdrawn: 0,
    votesDeleted: 0,
    membershipsClosed: 0,
    factionIdsCleared: 0,
    chairSeatsCleared: 0,
    viceChairSeatsCleared: 0,
  }),
}));

vi.mock("@/lib/turn/partyOrg/presence", () => ({
  updatePartyPresence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/parties/membershipEvents", () => ({
  emitPartyMembershipEvent: vi.fn().mockResolvedValue(undefined),
  buildPartyEventSnapshots: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn().mockResolvedValue(undefined),
}));

const mockCollections: Record<string, Record<string, Mock>> = {};

function setMockCollection(name: string, overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, Mock> = {
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    ...overrides,
  };
  mockCollections[name] = defaults;
  return defaults;
}

function makeDb(): Db {
  return {
    collection: vi.fn((name: string) => {
      if (!mockCollections[name]) setMockCollection(name);
      return mockCollections[name];
    }),
  } as unknown as Db;
}

function makeArgs(db: Db) {
  const character = {
    _id: new ObjectId(),
    name: "Joiner",
    party: "independent",
    homeState: "US-CA",
    userId: new ObjectId(),
  } as unknown as Character;
  const party = {
    _id: new ObjectId(),
    sequentialId: 3,
    countryId: "US",
    name: "Default Party",
    isDefault: true,
    chairId: null,
  } as unknown as PoliticalParty;
  return {
    db,
    character,
    party,
    countryId: "US" as const,
    currentTurn: 120,
    now: new Date(),
    autoChairWhenVacant: true,
    actor: { _id: character._id, name: character.name },
    actorRole: "self" as const,
  };
}

describe("applyCharacterPartyJoin — first-joiner auto-chair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockCollections)) {
      delete mockCollections[key];
    }
  });

  it("does not auto-chair when the party has an active chair election", async () => {
    const db = makeDb();
    setMockCollection("nationalPartyElections", {
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId() }), // active chair election
    });

    const result = await applyCharacterPartyJoin(makeArgs(db));

    expect(result.becameChair).toBe(false);
    // The party update must not set chairId.
    const partyUpdate = mockCollections["politicalParties"]!.updateOne.mock.calls[0]![1] as {
      $set?: Record<string, unknown>;
    };
    expect(partyUpdate.$set?.chairId).toBeUndefined();
  });

  it("still auto-chairs a chairless default party with no active chair election", async () => {
    const db = makeDb();
    setMockCollection("nationalPartyElections", {
      findOne: vi.fn().mockResolvedValue(null), // no active chair election
    });

    const args = makeArgs(db);
    const result = await applyCharacterPartyJoin(args);

    expect(result.becameChair).toBe(true);
    // The chair-election lookup is scoped to this party.
    const query = mockCollections["nationalPartyElections"]!.findOne.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(query).toMatchObject({
      partyId: "3",
      countryId: "US",
      position: "chair",
      status: "voting",
    });
  });

  it("skips the election lookup entirely when the toggle is off", async () => {
    const db = makeDb();
    const electionsFindOne = setMockCollection("nationalPartyElections").findOne;

    const result = await applyCharacterPartyJoin({ ...makeArgs(db), autoChairWhenVacant: false });

    expect(result.becameChair).toBe(false);
    expect(electionsFindOne).not.toHaveBeenCalled();
  });

  it("clears former-party caucus membership when switching parties (ticket #1030)", async () => {
    const db = makeDb();
    setMockCollection("nationalPartyElections", {
      findOne: vi.fn().mockResolvedValue(null),
    });

    const { cleanupCaucusParticipationForCharacters } =
      await import("@/lib/caucus/cleanupCaucusParticipationForCharacters");
    vi.mocked(cleanupCaucusParticipationForCharacters).mockClear();

    const args = makeArgs(db);
    args.character = {
      ...args.character,
      party: "1",
      factionId: new ObjectId(),
    } as unknown as Character;

    await applyCharacterPartyJoin(args);

    expect(cleanupCaucusParticipationForCharacters).toHaveBeenCalledWith(
      db,
      [args.character._id],
      expect.objectContaining({
        removeMembership: true,
        membershipStatus: "left",
      })
    );
  });

  it("does not run caucus cleanup when joining from independent", async () => {
    const db = makeDb();
    setMockCollection("nationalPartyElections", {
      findOne: vi.fn().mockResolvedValue(null),
    });

    const { cleanupCaucusParticipationForCharacters } =
      await import("@/lib/caucus/cleanupCaucusParticipationForCharacters");
    vi.mocked(cleanupCaucusParticipationForCharacters).mockClear();

    await applyCharacterPartyJoin(makeArgs(db));

    expect(cleanupCaucusParticipationForCharacters).not.toHaveBeenCalled();
  });
});
