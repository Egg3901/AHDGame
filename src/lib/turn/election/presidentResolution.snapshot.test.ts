/**
 * Freezing the night's result when a presidential race resolves.
 *
 * Two properties matter and they pull against each other. The capture has to
 * run, so history stops being recomputed against a map that has since moved on;
 * and it must never be able to take a turn down. An uncaught throw inside a
 * turn phase aborts that phase for every country, not just this race, so a
 * failed capture is swallowed and the race degrades to live computation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wiki/updatePoliticianPageOnElection", () => ({
  updatePoliticianPagesAfterElection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { electionResult: 0x00ff00 },
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/electionCalculations", () => ({
  allocateElectoralVotes: vi.fn(),
  determinePresidentialWinner: vi.fn(),
}));
vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: vi.fn().mockResolvedValue({
    findOne: vi.fn().mockResolvedValue({ currentTurn: 100, preset: undefined }),
  }),
}));
vi.mock("@/lib/achievements", () => ({
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionWinAchievements: vi.fn().mockResolvedValue(undefined),
  checkOfficeHeldAchievements: vi.fn().mockResolvedValue(undefined),
}));

// The payload builder has its own tests; here it is a seam, so the capture can
// be observed without standing up the whole results computation.
const buildResultsPayload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/elections/liveResults/buildResultsPayload", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/elections/liveResults/buildResultsPayload")>();
  return { ...actual, buildResultsPayload };
});

const NOW = new Date("2025-06-15T12:00:00Z");
const electionId = new ObjectId();
const winnerId = new ObjectId();
const loserId = new ObjectId();

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function payload() {
  return {
    election: {
      id: electionId.toString(),
      countryId: "US",
      electionType: "president",
      state: "US",
      status: "resolved",
      cycle: 3,
      electionYear: 1960,
      currentTurn: 100,
      startTurn: 1,
      endTurn: 2,
      totalSeats: 0,
      evNeeded: 266,
      totalEv: 531,
      finalHour: null,
    },
    candidates: [],
    units: [],
    national: null,
    summary: {
      totalVotes: 0,
      unitsReporting: 0,
      totalUnits: 0,
      unitsCalled: 0,
      projectedWinner: null,
    },
    isAdmin: false,
    lastUpdated: NOW.toISOString(),
  };
}

describe("capturing the result snapshot at resolution", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "electionVoteTallies",
      "electionCandidates",
      "characters",
      "npps",
      "electedOfficials",
      "campaigns",
      "politicalParties",
      "characterStateOrg",
      "gameState",
      "electionResultSnapshots",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 412,
      currentYear: 1995,
      preset: "1953-default",
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    buildResultsPayload.mockReset();
    buildResultsPayload.mockResolvedValue(payload());
  });

  /**
   * A full resolution with a clear winner. A race with no unit vote data
   * vacates and returns before the cleanup ever runs, so it cannot exercise
   * the capture.
   */
  const resolve = async () => {
    const { allocateElectoralVotes, determinePresidentialWinner } =
      await import("@/lib/turn/electionCalculations");
    vi.mocked(allocateElectoralVotes).mockReturnValue({
      [winnerId.toString()]: 300,
      [loserId.toString()]: 231,
    });
    vi.mocked(determinePresidentialWinner).mockReturnValue({
      winnerId: winnerId.toString(),
      winnerEV: 300,
    });

    const winnerCharacterId = new ObjectId();
    db.collectionMocks.electionCandidates!.find.mockReturnValue(
      makeCursor([
        {
          _id: winnerId,
          electionId,
          characterId: winnerCharacterId,
          characterName: "Winner",
          party: "1",
          isNPP: false,
          runningMateId: null,
        },
        {
          _id: loserId,
          electionId,
          characterId: new ObjectId(),
          characterName: "Loser",
          party: "2",
          isNPP: false,
        },
      ])
    );
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: winnerCharacterId,
      userId: new ObjectId(),
      name: "Winner",
    });
    db.collectionMocks.politicalParties!.find.mockReturnValue(makeCursor([]));

    const { resolvePresidentElection } = await import("./presidentResolution");
    return resolvePresidentElection(
      db as unknown as Db,
      {
        _id: electionId,
        countryId: "US",
        electionType: "president",
        state: "US",
        cycle: 3,
        electionYear: 1960,
        status: "completed",
      } as never,
      {
        electionId,
        totalVotesByUnit: {
          CA: { [winnerId.toString()]: 1000, [loserId.toString()]: 500 },
        },
      } as never,
      NOW
    );
  };

  it("writes a snapshot for the resolved race", async () => {
    await resolve();
    expect(db.collectionMocks.electionResultSnapshots!.updateOne).toHaveBeenCalledTimes(1);
    const [, update, options] = db.collectionMocks.electionResultSnapshots!.updateOne.mock.calls[0];
    const doc = update.$setOnInsert;
    expect(doc.electionId).toEqual(electionId);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.capturedAtTurn).toBe(412);
    expect(options).toEqual({ upsert: true });
  });

  it("freezes the college that governed the race, not the one in force now", async () => {
    await resolve();
    const [, update] = db.collectionMocks.electionResultSnapshots!.updateOne.mock.calls[0];
    const doc = update.$setOnInsert;
    expect(doc.totalEv).toBe(531);
    expect(doc.evNeeded).toBe(266);
  });

  it("scores the capture against the race's own year", async () => {
    // The world is in 1995; the race ran in 1960. Pinning the year is the whole
    // point, so assert the argument rather than trusting the payload.
    await resolve();
    expect(buildResultsPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: electionId }),
      expect.anything(),
      expect.objectContaining({ apportionmentYear: 1960 })
    );
  });

  it("does not take the turn down when the capture throws", async () => {
    db.collectionMocks.electionResultSnapshots!.updateOne.mockRejectedValue(new Error("boom"));
    await expect(resolve()).resolves.toBe(true);
  });

  it("does not take the turn down when the payload builder throws", async () => {
    buildResultsPayload.mockRejectedValue(new Error("boom"));
    await expect(resolve()).resolves.toBe(true);
  });
});
