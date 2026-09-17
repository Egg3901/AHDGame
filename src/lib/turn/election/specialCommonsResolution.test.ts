/**
 * Focused #860 additive-seating tests: a resolved `special_commons`
 * by-election fills only its claimed vacancies.
 *
 * A sitting MP keeps their official row and their `currentOffice` (no
 * delegation sweep, no stale-office clear), exactly one holder-less tombstone
 * is removed, and the winner is inserted as a regular `commons` MP. Same
 * MockDb style as `generalResolution.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wiki/updatePoliticianPageOnElection", () => ({
  updatePoliticianPagesAfterElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  triggerLeadershipElectionsAfterChamberVote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/election/presidentResolution", () => ({
  resolvePresidentElection: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/election/electionSpawning", () => ({
  spawnHouseElection: vi.fn().mockResolvedValue(undefined),
  spawnCommonsElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/partyOrg", () => ({
  updatePartyPresence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionWinAchievements: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2025-11-15T00:00:00Z");
const CURRENT_TURN = 20;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "elections",
    "electionVoteTallies",
    "electionCandidates",
    "electedOfficials",
    "characters",
    "npps",
    "campaigns",
    "statePartyOrg",
  ]) {
    db.collection(name);
  }
  db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);
});

describe("special_commons additive seating", () => {
  it("fills only the claimed tombstone: sitting MPs keep rows and currentOffice", async () => {
    const election = {
      _id: new ObjectId(),
      countryId: "UK",
      electionType: "special_commons",
      state: "LON",
      cycle: 1,
      status: "active",
      totalSeats: 1,
      createdAt: NOW,
      updatedAt: NOW,
    } as Election;

    const winnerId = new ObjectId();
    const tallyKey = winnerId.toString();
    const tally = {
      _id: new ObjectId(),
      electionId: election._id,
      state: "LON",
      totalVotes: { [tallyKey]: 1000 },
      candidateNames: {},
      candidateParties: {},
      turnSnapshots: [],
      finalized: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as ElectionVoteTally;

    const winnerCharacterId = new ObjectId();
    const winner = {
      _id: winnerId,
      electionId: election._id,
      characterId: winnerCharacterId,
      characterName: "By-Election Winner",
      party: "LAB",
      status: "active",
      isNPP: false,
      enteredAt: NOW,
    };
    const winnerUserId = new ObjectId();
    const winnerChar = { _id: winnerCharacterId, userId: winnerUserId, favorability: 60 };

    // One holder-less tombstone: the claimed vacancy this race fills.
    const tombstoneId = new ObjectId();
    const tombstone = {
      _id: tombstoneId,
      officeType: "commons",
      countryId: "UK",
      state: "LON",
      characterId: null,
      nppId: null,
    };
    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([winnerChar]));
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([tombstone]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);

    // Additive: every official-row delete targets the claimed tombstone ids,
    // never a broad delegation sweep.
    const deleteCalls = db.collectionMocks["electedOfficials"]!.deleteMany.mock.calls;
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    for (const [filter] of deleteCalls) {
      const ids = (filter as { _id?: { $in?: ObjectId[] } })?._id?.$in?.map(String);
      // Every delete is id-targeted at claimed tombstones; a broad sweep
      // would carry no `_id.$in` at all.
      expect(ids).toBeDefined();
      expect(ids).toContain(tombstoneId.toString());
    }

    // The winner is seated as a regular Commons MP.
    const inserts = db.collectionMocks["electedOfficials"]!.insertOne.mock.calls;
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    const winnerInsert = inserts.find((c) =>
      JSON.stringify(c[0] ?? {}).includes("By-Election Winner")
    );
    expect(winnerInsert).toBeDefined();
    expect(winnerInsert![0]).toMatchObject({ officeType: "commons", state: "LON" });

    // No stale-office sweep: sitting MPs keep their currentOffice, so neither
    // characters nor NPPs are bulk-cleared.
    expect(db.collectionMocks["characters"]!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["npps"]!.updateMany).not.toHaveBeenCalled();

    // A by-election never respawns the regular cycle.
    const { spawnCommonsElection } = await import("./electionSpawning");
    expect(vi.mocked(spawnCommonsElection)).not.toHaveBeenCalled();
  });

  it("a regular commons race still sweeps the delegation", async () => {
    const election = {
      _id: new ObjectId(),
      countryId: "UK",
      electionType: "commons",
      state: "LON",
      cycle: 1,
      status: "active",
      totalSeats: 75,
      createdAt: NOW,
      updatedAt: NOW,
    } as Election;

    const winnerId = new ObjectId();
    const tallyKey = winnerId.toString();
    const tally = {
      _id: new ObjectId(),
      electionId: election._id,
      state: "LON",
      totalVotes: { [tallyKey]: 1000 },
      candidateNames: {},
      candidateParties: {},
      turnSnapshots: [],
      finalized: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as ElectionVoteTally;

    const winner = {
      _id: winnerId,
      electionId: election._id,
      characterId: new ObjectId(),
      characterName: "General Winner",
      party: "LAB",
      status: "active",
      isNPP: false,
      enteredAt: NOW,
    };

    db.collectionMocks["electionCandidates"]!.find.mockReturnValue(makeCursor([winner]));

    const { resolveOneGeneralElection } = await import("./generalResolution");
    const result = await resolveOneGeneralElection(
      db as unknown as Db,
      election,
      tally,
      CURRENT_TURN,
      NOW
    );

    expect(result.resolved).toBe(true);
    // Regular races clear the whole regional delegation before seating.
    const deleteCalls = db.collectionMocks["electedOfficials"]!.deleteMany.mock.calls;
    const broadSweep = deleteCalls.some(
      (c) => (c[0] as Record<string, unknown>)?.state === "LON" && !("_id" in (c[0] as object))
    );
    expect(broadSweep).toBe(true);
  });
});
